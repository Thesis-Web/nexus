import { randomUUID } from 'crypto';
export function uuid() {
    return randomUUID();
}
export function nowIso() {
    return new Date().toISOString();
}
export function addSeconds(iso, seconds) {
    return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}
export function isExpired(expiresAt) {
    return new Date(expiresAt).getTime() <= Date.now();
}
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
export function durationMs(startIso) {
    return Date.now() - new Date(startIso).getTime();
}
