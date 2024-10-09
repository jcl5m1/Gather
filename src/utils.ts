export let logDiv: HTMLDivElement;
export let resourceDiv: HTMLDivElement;

export function init(document: Document) {
    logDiv = document.createElement('div');
    logDiv.style.position = 'absolute';
    logDiv.style.top = '10px';
    logDiv.style.left = '10px';
    logDiv.style.color = 'white';
    logDiv.style.fontSize = '15px';
    logDiv.style.fontFamily = 'Arial';
    logDiv.innerText = `Console:`;
    document.body.appendChild(logDiv);

    resourceDiv = document.createElement('div');
    resourceDiv.style.position = 'absolute';
    resourceDiv.style.top = '10px';
    resourceDiv.style.right = '10px';
    resourceDiv.style.color = 'white';
    resourceDiv.style.fontSize = '15px';
    resourceDiv.style.fontFamily = 'Arial';
    resourceDiv.innerText = `Resources:`;
    document.body.appendChild(resourceDiv);
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

export function updateResources(resources: { [key: string]: number }) {
    if (!resourceDiv) {
        return;
    }

    resourceDiv.innerText = `Resources:\n`;
    for (const key in resources) {
        resourceDiv.innerText += `${key}: ${resources[key]}\n`;
    }
}