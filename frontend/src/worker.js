/* eslint-disable camelcase */
import { AutoModel, AutoProcessor, env } from "@xenova/transformers";

// Enable local models only and set local path served by Vite (public/models → /models)
env.allowLocalModels = true;
env.localModelPath = '/models/';
env.allowRemoteModels = false;
env.remoteModelsBlocked = true;

// Load vocabulary for manual token decoding
let vocab = null;
let idToToken = {};

async function loadVocabulary() {
    if (vocab === null) {
        try {
            // const response = await fetch('./models/pteacher/wav2vec2-ky-hiva/vocab.json');
            const response = await fetch('/models/pteacher/wav2vec2-ky-hiva/vocab.json');
            vocab = await response.json();
            
            // Create id to token mapping
            idToToken = {};
            for (const [token, id] of Object.entries(vocab)) {
                idToToken[id] = token;
            }
        } catch (error) {
            console.error('Failed to load vocabulary:', error);
            // Fallback vocabulary
            vocab = {
                "[PAD]": 39,
                "[UNK]": 38,
                "|": 15,
                "а": 6, "б": 37, "в": 14, "г": 26, "д": 8, "е": 10, "ж": 31, "з": 21,
                "и": 16, "й": 3, "к": 1, "л": 35, "м": 33, "н": 20, "о": 34, "п": 24,
                "р": 12, "с": 5, "т": 0, "у": 11, "ф": 9, "х": 23, "ц": 19, "ч": 30,
                "ш": 28, "щ": 17, "ъ": 18, "ы": 29, "ь": 32, "э": 4, "ю": 36, "я": 2,
                "ё": 13, "ң": 22, "ү": 25, "ӊ": 7, "ө": 27
            };
            for (const [token, id] of Object.entries(vocab)) {
                idToToken[id] = token;
            }
        }
    }
}

function decodeTokens(tokenIds) {
    return tokenIds
        .map(id => idToToken[id] || `[UNK_${id}]`)
        .filter(token => token !== '[PAD]' && token !== '<s>' && token !== '</s>')
        .join('');
}

function ctcDecode(tokenIds) {
    // CTC decoding: remove consecutive duplicates and blank tokens
    const decoded = [];
    let prevToken = null;
    
    for (let i = 0; i < tokenIds.length; i++) {
        const tokenId = tokenIds[i];
        const token = idToToken[tokenId] || `[UNK_${tokenId}]`;
        
        // Skip blank tokens (usually represented as [PAD] or empty)
        if (token === '[PAD]' || token === '<s>' || token === '</s>') {
            continue;
        }
        
        // Skip consecutive duplicate tokens (CTC property)
        if (token !== prevToken) {
            decoded.push(token);
            prevToken = token;
        }
    }
    
    return decoded.join('');
}

function postProcessText(text) {
    // Replace | with space and clean up the text
    return text
        .replace(/\|/g, ' ')  // Replace | with space
        .replace(/\s+/g, ' ') // Replace multiple spaces with single space
        .trim(); // Remove leading/trailing whitespace
}

// Define model factories for direct wav2vec loading
class Wav2VecFactory {
    static model = null;
    static quantized = null;
    static modelInstance = null;
    static processorInstance = null;
    static isLoaded = false;
    static isLoading = false;

    static async getInstance(progress_callback = null) {
        // If already loaded, return immediately
        if (this.isLoaded && this.modelInstance && this.processorInstance) {
            return {
                model: this.modelInstance,
                processor: this.processorInstance
            };
        }

        // If currently loading, wait for it to complete
        if (this.isLoading) {
            return new Promise((resolve) => {
                const checkLoaded = () => {
                    if (this.isLoaded && this.modelInstance && this.processorInstance) {
                        resolve({
                            model: this.modelInstance,
                            processor: this.processorInstance
                        });
                    } else {
                        setTimeout(checkLoaded, 100);
                    }
                };
                checkLoaded();
            });
        }

        // Start loading
        this.isLoading = true;
        
        try {
            // Load vocabulary first
            await loadVocabulary();
            
            // Load model and processor directly from local path
            this.modelInstance = await AutoModel.from_pretrained("pteacher/wav2vec2-ky-hiva", {
                progress_callback
            });
            
            this.processorInstance = await AutoProcessor.from_pretrained("pteacher/wav2vec2-ky-hiva", {
                progress_callback
            });

            this.isLoaded = true;
            this.isLoading = false;

            // Send ready message to main thread
            if (progress_callback) {
                progress_callback({
                    status: "ready",
                    message: "Model loaded successfully"
                });
            }

            return {
                model: this.modelInstance,
                processor: this.processorInstance
            };
        } catch (error) {
            this.isLoading = false;
            throw error;
        }
    }

    static dispose() {
        if (this.modelInstance) {
            this.modelInstance.dispose();
            this.modelInstance = null;
        }
        if (this.processorInstance) {
            this.processorInstance.dispose();
            this.processorInstance = null;
        }
        this.isLoaded = false;
        this.isLoading = false;
    }
}

self.addEventListener("message", async (event) => {
    const message = event.data;

    // Do some work...
    let transcript = await transcribe(
        message.audio,
        message.model,
        message.multilingual,
        message.quantized,
        message.subtask,
        message.language,
    );
    if (transcript === null) return;

    // Send the result back to the main thread
    self.postMessage({
        status: "complete",
        task: "automatic-speech-recognition",
        data: transcript,
    });
});

const transcribe = async (
    audio,
    model,
    multilingual,
    quantized,
    subtask,
    language,
) => {
    try {
        // Load the wav2vec model and processor directly
        const { model: wav2vecModel, processor } = await Wav2VecFactory.getInstance((data) => {
            self.postMessage(data);
        });

        // Send message that model is ready for transcription
        self.postMessage({
            status: "model_ready",
            message: "Model ready for transcription"
        });

        // Process audio with the processor
        const inputs = await processor(audio);
        
        // Get raw model outputs
        const outputs = await wav2vecModel(inputs);
        const logits = outputs.logits;
        
        // Manual argmax implementation to get predicted token IDs
        const [batchSize, seqLen, vocabSize] = logits.dims;
        const predictedIds = [];
        
        // For each time step, find the token with highest probability
        for (let t = 0; t < seqLen; t++) {
            let maxLogit = -Infinity;
            let maxTokenId = 0;
            
            // Check each token in vocabulary
            for (let v = 0; v < vocabSize; v++) {
                const logitValue = logits.data[t * vocabSize + v];
                if (logitValue > maxLogit) {
                    maxLogit = logitValue;
                    maxTokenId = v;
                }
            }
            
            predictedIds.push(maxTokenId);
        }
        
        // Apply CTC decoding to remove duplicates and blank tokens
        const ctcDecodedText = ctcDecode(predictedIds);
        
        // Post-process the text: replace | with space and clean up
        const finalText = postProcessText(ctcDecodedText);
        
        // Create chunks with timestamps (simplified approach)
        // For now, we'll create a single chunk with the full text
        const chunks = [{
            text: finalText,
            timestamp: [0, null] // Start at 0, end time not specified
        }];
        
        // Send progress update
        self.postMessage({
            status: "update",
            task: "automatic-speech-recognition",
            data: [finalText, { chunks }],
        });
        
        // Return the final result
        return {
            text: finalText,
            chunks: chunks
        };
        
    } catch (error) {
        console.error("Transcription error:", error);
        self.postMessage({
            status: "error",
            task: "automatic-speech-recognition",
            data: error,
        });
        return null;
    }
};
