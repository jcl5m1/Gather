export let logDiv: HTMLDivElement;

export function initLogDiv(document: Document) {
    logDiv = document.createElement('div');
    logDiv.style.position = 'absolute';
    logDiv.style.top = '10px';
    logDiv.style.left = '10px';
    logDiv.style.color = 'white';
    logDiv.style.fontSize = '15px';
    logDiv.style.fontFamily = 'Arial';
    logDiv.innerText = `Console:`;
    document.body.appendChild(logDiv);
}

export function appendToLog(text: string) {

    if (!logDiv) {
        return;
    }

    console.log(text);
    const maxLines = 10;
    const lines = logDiv?.innerText ? logDiv.innerText.split('\n') : [];
    lines.push(text);
    if (lines.length > maxLines) {
        lines.splice(0, lines.length - maxLines);
    }
    logDiv.innerText = lines.join('\n');
}
