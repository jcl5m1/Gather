import { logDiv } from "./globals";
export function appendToLog(text) {
    console.log(text);
    const maxLines = 10;
    const lines = logDiv.innerText.split('\n');
    lines.push(text);
    if (lines.length > maxLines) {
        lines.splice(0, lines.length - maxLines);
    }
    logDiv.innerText = lines.join('\n');
}
