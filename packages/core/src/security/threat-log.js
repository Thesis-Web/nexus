import { truncate } from '../utils/helpers.js';
export function buildThreatEvent(threatType, gateId, detail) {
    return {
        threatType,
        detectedAt: new Date().toISOString(),
        gateId,
        detail: truncate(detail, 300),
    };
}
