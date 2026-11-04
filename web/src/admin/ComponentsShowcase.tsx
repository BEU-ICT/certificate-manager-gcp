import { useState } from 'react';
import {
  Badge,
  Button,
  Checkbox,
  Combobox,
  ConfirmDialog,
  DatePicker,
  EmptyState,
  ErrorState,
  FileDropzone,
  Pagination,
  Select,
  Skeleton,
  Spinner,
  Table,
  TextArea,
  TextField,
  useToast,
} from '@/components';

// Developer gallery, only reachable in `vite` dev mode (see AdminApp); not localized on purpose.
const countries = [
  { value: 'az', label: 'Azerbaijan' },
  { value: 'tr', label: 'Türkiye' },
  { value: 'ge', label: 'Georgia' },
];
const cities: Record<string, { value: string; label: string }[]> = {
  az: [
    { value: 'bak', label: 'Bakı' },
    { value: 'gnc', label: 'Gəncə' },
    { value: 'sum', label: 'Sumqayıt' },
  ],
  tr: [{ value: 'ist', label: 'İstanbul' }],
  ge: [{ value: 'tbs', label: 'Tbilisi' }],
};
const rows = Array.from({ length: 12 }, (_, i) => ({
  id: String(i),
  name: `Certificate ${i + 1}`,
  status: i % 3 === 0 ? 'revoked' : 'active',
  holder: 'Əli Məmmədov ıöüçşğ',
  issued: '2026-11-04',
}));

export default function ComponentsShowcase() {
  const toast = useToast();
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <h1 className="text-2xl font-semibold">Components</h1>
      <section className="flex flex-wrap items-center gap-2">
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="danger">Danger</Button>
        <Button variant="ghost">Ghost</Button>
        <Button loading>Loading</Button>
        <Badge tone="success">active</Badge>
        <Badge tone="danger">revoked</Badge>
        <Spinner />
        <Skeleton className="h-6 w-32" />
      </section>
      <section className="grid gap-4 sm:grid-cols-2">
        <TextField label="Name" hint="As on the certificate" required />
        <TextField label="Email" type="email" error="Enter a valid email" />
        <TextArea label="Notes" />
        <DatePicker label="Date" />
        <Select
          label="Role"
          options={[
            { value: 'a', label: 'Admin' },
            { value: 'b', label: 'Editor' },
          ]}
        />
        <Checkbox label="I agree" />
        <Combobox
          label="Country"
          options={countries}
          value={country}
          onChange={(v) => {
            setCountry(v);
            setCity('');
          }}
        />
        <Combobox
          label="City (depends on country)"
          options={cities[country] ?? []}
          value={city}
          onChange={setCity}
          disabled={!country}
        />
      </section>
      <FileDropzone label="Upload CSV" accept=".csv" onFiles={() => undefined} />
      <section className="flex flex-wrap gap-2">
        <Button onClick={() => setConfirm(true)}>Open dialog</Button>
        <Button variant="secondary" onClick={() => toast.show('Saved', 'success')}>
          Toast
        </Button>
        <ConfirmDialog
          open={confirm}
          title="Delete?"
          message="This cannot be undone."
          destructive
          onCancel={() => setConfirm(false)}
          onConfirm={() => setConfirm(false)}
        />
      </section>
      <Table
        caption="Certificates"
        rows={rows}
        getRowKey={(r) => r.id}
        maxHeightClass="max-h-72"
        columns={[
          { key: 'name', header: 'Name', cell: (r) => r.name },
          { key: 'holder', header: 'Holder', cell: (r) => r.holder },
          { key: 'issued', header: 'Issued', cell: (r) => r.issued },
          {
            key: 'status',
            header: 'Status',
            cell: (r) => (
              <Badge tone={r.status === 'active' ? 'success' : 'danger'}>{r.status}</Badge>
            ),
          },
        ]}
      />
      <Pagination hasPrevious hasNext onPrevious={() => undefined} onNext={() => undefined} />
      <EmptyState description="Nothing here yet." />
      <ErrorState message="Could not load." requestId="req_123" onRetry={() => undefined} />
    </div>
  );
}
