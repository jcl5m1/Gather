function send(level: string, ...args: unknown[]): void {
    const msg = args.map(a =>
        a instanceof Error    ? `${a.message}\n${a.stack ?? ''}` :
        typeof a === 'object' ? JSON.stringify(a) : String(a)
    ).join(' ');

    if (level === 'ERROR') console.error(...args);
    else if (level === 'WARN') console.warn(...args);
    else console.log(...args);

    const url = `/log?level=${level}&msg=${encodeURIComponent(msg)}`;

    // sendBeacon queues the request to survive page unloads/crashes — more reliable than fetch
    if (navigator.sendBeacon) {
        navigator.sendBeacon(url);
    } else {
        fetch(url).catch(() => {});
    }
}

export const log = {
    info:  (...args: unknown[]) => send('INFO',  ...args),
    warn:  (...args: unknown[]) => send('WARN',  ...args),
    error: (...args: unknown[]) => send('ERROR', ...args),
};

export function installGlobalErrorHandlers(): void {
    window.onerror = (msg, src, line, col, err) => {
        send('UNCAUGHT', `${msg} — ${src}:${line}:${col}${err ? '\n' + err.stack : ''}`);
        return false;
    };
    window.addEventListener('unhandledrejection', e => {
        send('UNHANDLED_REJECTION', String(e.reason));
    });
}
