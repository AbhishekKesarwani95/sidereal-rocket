// Crypto utilities for E2EE — ECDH key exchange + AES-GCM encryption
// These functions run 100% in the browser using the Web Crypto API.

export async function generateECDHKeyPair(): Promise<CryptoKeyPair> {
    return crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        false, // private key not extractable
        ['deriveKey']
    );
}

export async function exportPublicKey(keyPair: CryptoKeyPair): Promise<string> {
    const raw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
    return btoa(String.fromCharCode(...new Uint8Array(raw)));
}

export async function importPublicKey(b64: string): Promise<CryptoKey> {
    const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    return crypto.subtle.importKey(
        'raw', raw,
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        []
    );
}

export async function deriveSharedKey(
    myPrivate: CryptoKey,
    theirPublic: CryptoKey
): Promise<CryptoKey> {
    return crypto.subtle.deriveKey(
        { name: 'ECDH', public: theirPublic },
        myPrivate,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

// Derive a key from a passphrase using PBKDF2
export async function deriveKeyFromPassphrase(
    passphrase: string,
    salt: Uint8Array
): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey(
        'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt as unknown as Uint8Array<ArrayBuffer>, iterations: 200000, hash: 'SHA-256' },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

// Generate a random room salt for passphrase-based KDF
export function generateSalt(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(16));
}

// Encrypt a frame (Uint8Array) with AES-GCM
export async function encryptFrame(
    key: CryptoKey,
    data: Uint8Array
): Promise<Uint8Array> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv as unknown as Uint8Array<ArrayBuffer> },
        key,
        data as unknown as Uint8Array<ArrayBuffer>
    );
    // Prepend IV to ciphertext
    const result = new Uint8Array(12 + encrypted.byteLength);
    result.set(iv, 0);
    result.set(new Uint8Array(encrypted), 12);
    return result;
}

// Decrypt a frame; returns null on failure (key mismatch, corrupted)
export async function decryptFrame(
    key: CryptoKey,
    data: Uint8Array
): Promise<Uint8Array | null> {
    try {
        const iv = data.slice(0, 12);
        const ciphertext = data.slice(12);
        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            key,
            ciphertext
        );
        return new Uint8Array(decrypted);
    } catch {
        return null;
    }
}

// Encrypt a text string (for chat messages)
export async function encryptText(key: CryptoKey, text: string): Promise<string> {
    const enc = new TextEncoder();
    const encrypted = await encryptFrame(key, enc.encode(text));
    return btoa(String.fromCharCode(...encrypted));
}

// Decrypt a text string
export async function decryptText(key: CryptoKey, b64: string): Promise<string | null> {
    try {
        const data = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        const dec = await decryptFrame(key, data);
        if (!dec) return null;
        return new TextDecoder().decode(dec);
    } catch {
        return null;
    }
}
