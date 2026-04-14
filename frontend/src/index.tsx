import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from 'react-router-dom';
// Direct App
import "./css/index.css";
import { useUiStore } from "./state/uiStore";
import App from "./App";


// function Root() {
//     const theme = useUiStore((s) => s.theme);
//     React.useEffect(() => {
//         const root = document.documentElement;
//         if (theme === "dark") root.classList.add("dark");
//         else root.classList.remove("dark");
//     }, [theme]);

// return <BrowserRouter><App /></BrowserRouter>;
// }
ReactDOM.createRoot(document.getElementById("root")!).render(
    <BrowserRouter>
      <App />
    </BrowserRouter>
  );
