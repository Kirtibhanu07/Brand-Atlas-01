export const slug = (value) => value
  .normalize("NFKD")
  .replace(/[^a-zA-Z0-9]+/g, "-")
  .replace(/^-|-$/g, "")
  .toLowerCase()
  .slice(0, 70) || "unknown-logo";

export function mergeCandidates(records) {
  const map = new Map();
  const logoOwners = new Map();
  for (const record of records) {
    const nameKey = record.name.toLowerCase().replace(/[^a-z0-9]+/g, "") || record.logo.sha256;
    const key = logoOwners.get(record.logo.sha256) || nameKey;
    let brand = map.get(key);
    if (!brand) {
      brand = {
        id: slug(record.name), name: record.name, nameSource: record.nameSource,
        confidence: record.confidence, reviewRequired: record.reviewRequired,
        relationship: record.relationship, relationships: [record.relationship],
        section: record.section, brandUrl: record.brandUrl, evidence: [], logos: [],
      };
      map.set(key, brand);
    } else if (record.confidence > brand.confidence || (!record.reviewRequired && brand.reviewRequired)) {
      Object.assign(brand, {
        id: slug(record.name), name: record.name, nameSource: record.nameSource,
        confidence: record.confidence, reviewRequired: record.reviewRequired,
        relationship: record.relationship, relationships: [record.relationship],
        section: record.section, brandUrl: record.brandUrl || brand.brandUrl,
      });
    }
    logoOwners.set(record.logo.sha256, key);
    if (!brand.relationships.includes(record.relationship)) {
      brand.relationships.push(record.relationship);
      brand.relationship = brand.relationships.join("; ");
    }
    brand.confidence = Math.max(brand.confidence, record.confidence);
    brand.reviewRequired = brand.reviewRequired && record.reviewRequired;
    if (!brand.brandUrl && record.brandUrl) brand.brandUrl = record.brandUrl;
    if (!brand.evidence.some((item) => item.sourcePage === record.sourcePage && item.sourceUrl === record.sourceUrl)) {
      brand.evidence.push({ sourcePage: record.sourcePage, sourceUrl: record.sourceUrl, section: record.section, text: record.evidence });
    }
    if (!brand.logos.some((logo) => logo.sha256 === record.logo.sha256)) brand.logos.push(record.logo);
  }
  return [...map.values()].sort((a, b) => a.relationship.localeCompare(b.relationship) || a.name.localeCompare(b.name));
}
