/**
 * Data classifier — spec §13.3
 * Classifies data classes from intent, target, and verb.
 */
import { DATA_CLASS, } from '../types/index.js';
const PII_KEYWORDS = /\b(name|email|phone|address|ssn|dob|date.of.birth|passport|id.number|national.id)\b/i;
const PHI_KEYWORDS = /\b(medical|health|diagnosis|prescription|patient|hipaa|clinical|lab.result|treatment)\b/i;
const FIN_KEYWORDS = /\b(payment|credit.card|bank|invoice|billing|financial|revenue|salary|account.number)\b/i;
export class DataClassifier {
    classify(intent, target, _verb) {
        const classes = new Set();
        const haystack = [
            intent.objectiveSummary,
            intent.riskNote ?? '',
            target.resourceType,
            target.system,
        ]
            .join(' ')
            .toLowerCase();
        if (PII_KEYWORDS.test(haystack))
            classes.add(DATA_CLASS.PII);
        if (PHI_KEYWORDS.test(haystack))
            classes.add(DATA_CLASS.PHI);
        if (FIN_KEYWORDS.test(haystack))
            classes.add(DATA_CLASS.FINANCIAL);
        // Default to internal if nothing detected
        if (classes.size === 0) {
            classes.add(target.externalFacing ? DATA_CLASS.CONFIDENTIAL : DATA_CLASS.INTERNAL);
        }
        return [...classes];
    }
}
