/** A refusal or failure reported by the MMO client (`type` is the request that failed, when known). */
export class MmoError extends Error {
    constructor(message, type = null) {
        super(message);
        this.name = 'MmoError';
        this.type = type;
    }
}
