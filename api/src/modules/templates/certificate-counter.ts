/**
 * Narrow port the templates module needs from the certificates module: how many certificates
 * were rendered from a template version. The certificates epic (E7) wires a real implementation
 * (a `count()` aggregation on `templateId` behind its `CertificateService`) in `src/services.ts`.
 */
export interface TemplateCertificateCounter {
  countByTemplate(reference: string): Promise<number>;
}

/** Default until E7 wires the real counter: no certificates are known, so the count is 0. */
export const NO_CERTIFICATES: TemplateCertificateCounter = {
  countByTemplate: () => Promise.resolve(0),
};
