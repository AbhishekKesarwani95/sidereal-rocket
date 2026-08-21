// Room code generation — 122 bits of entropy, URL-safe
export function generateRoomCode(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    // Base62 encode for cleaner URLs
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    let n = BigInt('0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(''));
    let result = '';
    const base = BigInt(62);
    while (n > 0) {
        result = chars[Number(n % base)] + result;
        n /= base;
    }
    return result.padStart(22, '0');
}

export function isValidRoomCode(code: string): boolean {
    return /^[0-9A-Za-z]{10,30}$/.test(code);
}

export function formatRoomCode(code: string): string {
    // Format as XXXX-XXXX-XXXX for display
    const clean = code.replace(/-/g, '');
    return clean.match(/.{1,6}/g)?.join('-') ?? code;
}

export function buildShareUrl(code: string): string {
    return `${window.location.origin}/room/${code}`;
}

export function buildShareLinks(code: string) {
    const url = encodeURIComponent(buildShareUrl(code));
    const text = encodeURIComponent(`Join my anonymous blur call on Veilcall! Room code: ${code}`);
    return {
        whatsapp: `https://wa.me/?text=${text}%20${url}`,
        telegram: `https://t.me/share/url?url=${url}&text=${text}`,
        sms: `sms:?body=${text}%20${url}`,
        twitter: `https://twitter.com/intent/tweet?text=${text}&url=${url}`,
        copy: buildShareUrl(code),
    };
}
