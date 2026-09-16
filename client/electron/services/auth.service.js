// JWT stored in OS keychain via keytar
let _token = null;
export async function saveToken(token) {
    try {
        const keytar = await import('keytar');
        await keytar.setPassword('BarakaPOS', 'jwt', token);
    }
    catch {
        // Fallback: in-memory only
        _token = token;
    }
}
export async function getToken() {
    try {
        const keytar = await import('keytar');
        return await keytar.getPassword('BarakaPOS', 'jwt');
    }
    catch {
        return _token;
    }
}
export async function clearToken() {
    try {
        const keytar = await import('keytar');
        await keytar.deletePassword('BarakaPOS', 'jwt');
    }
    catch {
        _token = null;
    }
}
