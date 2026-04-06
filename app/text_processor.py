import numpy as np
from app.text import text_to_sequence

class KyrgyzTextProcessor:
    def __init__(self):
        # Match the cleaner name exactly to your training config
        self.cleaner_names = ["kygryz_cleaners2"] 

    def text_to_sequence(self, text):
        # We use the official text_to_sequence logic from your project files
        sequence = text_to_sequence(text, self.cleaner_names)
        
        # Matcha ONNX models often expect a specific 'blank' token (ID 0) 
        # between characters. If your Ubuntu inference adds these, 
        # we need to ensure they are here.
        
        return sequence