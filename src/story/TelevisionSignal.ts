/** Reconstructed from the saved outage and corridor relighting flags. */
export type TelevisionSignal='normal'|'static'|'broadcast';
export const televisionSignal=(outage:boolean,relit:boolean):TelevisionSignal=>outage?relit?'broadcast':'static':'normal';
