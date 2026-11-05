import type {
  CertificateRepository,
  Filter,
  FilterValue,
  Page,
  PageRequest,
} from '../../ports/index.js';
import type { Certificate } from '../../shared/domain.js';
import { ConflictError } from '../../shared/errors.js';
import type { CertificateId } from '../../shared/ids.js';
import { MemoryTable } from './memory-table.js';

const FIELDS = [
  'id',
  'organizationId',
  'eventId',
  'templateId',
  'type',
  'status',
  'issuedAt',
  'emailStatus',
];

type Comparable = string | number | boolean;
const comparable = (v: unknown): Comparable =>
  v instanceof Date ? v.getTime() : (v as Comparable);

function matchesValue(actual: unknown, wanted: FilterValue): boolean {
  if (typeof wanted === 'object' && !(wanted instanceof Date)) {
    const a = comparable(actual);
    const { gte, lte } = wanted;
    return (
      (gte === undefined || a >= comparable(gte)) && (lte === undefined || a <= comparable(lte))
    );
  }
  return comparable(actual) === comparable(wanted);
}

function matcher(filter: Filter): (c: Certificate) => boolean {
  const entries = Object.entries(filter).filter(
    (e): e is [string, FilterValue] => e[1] !== undefined,
  );
  for (const [field] of entries) {
    if (!FIELDS.includes(field)) throw new Error(`Unknown certificate filter field: ${field}`);
  }
  return (c) =>
    entries.every(([field, wanted]) => matchesValue(c[field as keyof Certificate], wanted));
}

export class FakeCertificateRepository implements CertificateRepository {
  private readonly table = new MemoryTable<Certificate>();

  create(certificate: Certificate): Promise<void> {
    if (this.table.find((c) => c.id === certificate.id)) {
      return Promise.reject(new ConflictError('Certificate already exists'));
    }
    this.table.add(certificate, certificate.issuedAt);
    return Promise.resolve();
  }

  getById(id: CertificateId): Promise<Certificate | null> {
    const row = this.table.find((c) => c.id === id);
    return Promise.resolve(row ? structuredClone(row.item) : null);
  }

  list(filter: Filter, page?: PageRequest): Promise<Page<Certificate>> {
    return Promise.resolve().then(() =>
      this.table.paginate(this.table.select(matcher(filter)), page),
    );
  }

  count(filter: Filter): Promise<number> {
    return Promise.resolve().then(() => this.table.select(matcher(filter)).length);
  }

  revoke(id: CertificateId, at: Date): Promise<boolean> {
    const row = this.table.find((c) => c.id === id);
    if (!row) return Promise.resolve(false);
    if (row.item.status !== 'revoked') {
      row.item.status = 'revoked';
      row.item.revokedAt = at;
    }
    return Promise.resolve(true);
  }
}
