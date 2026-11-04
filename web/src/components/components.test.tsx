import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from '@/test/axe';
import {
  Badge,
  Button,
  Checkbox,
  Combobox,
  ConfirmDialog,
  DatePicker,
  Dialog,
  EmptyState,
  ErrorState,
  FileDropzone,
  FormField,
  Pagination,
  Select,
  Skeleton,
  Spinner,
  Table,
  TextArea,
  TextField,
  ToastProvider,
  useToast,
} from '.';

describe('Button', () => {
  it('renders variants and fires onClick', async () => {
    const onClick = vi.fn();
    const { container } = render(
      <>
        <Button onClick={onClick}>Save</Button>
        <Button variant="danger">Delete</Button>
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('is disabled and busy while loading', async () => {
    const onClick = vi.fn();
    const { container } = render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: /Save/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('FormField / TextField / TextArea / DatePicker', () => {
  it('links hint and error through aria-describedby', async () => {
    const { container } = render(
      <TextField label="Email" hint="Work address" error="Invalid email" required />,
    );
    const input = screen.getByLabelText(/Email/);
    expect(input).toBeInvalid();
    expect(input).toBeRequired();
    const ids = (input.getAttribute('aria-describedby') ?? '').split(' ');
    expect(ids).toHaveLength(2);
    expect(document.getElementById(ids[0] ?? '')).toHaveTextContent('Work address');
    expect(document.getElementById(ids[1] ?? '')).toHaveTextContent('Invalid email');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('FormField has no aria-describedby without hint or error', () => {
    render(<FormField label="X">{(c) => <input {...c} />}</FormField>);
    expect(screen.getByLabelText('X')).not.toHaveAttribute('aria-describedby');
  });

  it('accepts typing in TextField and TextArea', async () => {
    const { container } = render(
      <>
        <TextField label="Name" />
        <TextArea label="Notes" />
      </>,
    );
    await userEvent.type(screen.getByLabelText('Name'), 'Əli');
    await userEvent.type(screen.getByLabelText('Notes'), 'ıöüçşğ');
    expect(screen.getByLabelText('Name')).toHaveValue('Əli');
    expect(screen.getByLabelText('Notes')).toHaveValue('ıöüçşğ');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('DatePicker is a native date input', async () => {
    const { container } = render(<DatePicker label="Date" defaultValue="2026-11-04" />);
    const input = screen.getByLabelText('Date');
    expect(input).toHaveAttribute('type', 'date');
    expect(input).toHaveValue('2026-11-04');
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Select', () => {
  const options = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
  ];

  it('is operable with the keyboard', async () => {
    const onChange = vi.fn();
    const { container } = render(<Select label="Letter" options={options} onChange={onChange} />);
    await userEvent.tab();
    expect(screen.getByLabelText('Letter')).toHaveFocus();
    // user-event does not emulate the browser's native arrow-key handling of <select>; selecting
    // via the keyboard-focused control is equivalent to what the browser does.
    await userEvent.selectOptions(screen.getByLabelText('Letter'), 'a');
    expect(onChange).toHaveBeenCalled();
    expect(screen.getByLabelText('Letter')).toHaveValue('a');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows an error linked to the control', async () => {
    const { container } = render(<Select label="Letter" options={options} error="Required" />);
    expect(screen.getByLabelText('Letter')).toBeInvalid();
    expect(screen.getByLabelText('Letter')).toHaveAccessibleDescription('Required');
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Combobox', () => {
  const options = [
    { value: 'bak', label: 'Bakı' },
    { value: 'gnc', label: 'Gəncə' },
    { value: 'sum', label: 'Sumqayıt' },
  ];
  function Harness({ disabled }: { disabled?: boolean }) {
    const [v, setV] = useState('');
    return (
      <Combobox
        label="City"
        options={options}
        value={v}
        onChange={setV}
        {...(disabled ? { disabled } : {})}
      />
    );
  }

  it('filters, navigates with arrows and selects with Enter', async () => {
    const { container } = render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'City' });
    await userEvent.click(input);
    await userEvent.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('option')).toHaveLength(3);
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(input).toHaveValue('Gəncə');
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('filters by typed text, closes on Escape and shows an empty message', async () => {
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'City' });
    await userEvent.type(input, 'sum');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    await userEvent.keyboard('{Escape}');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    await userEvent.type(input, 'zzz');
    expect(screen.getByText('No results found')).toBeInTheDocument();
  });

  it('selects with the mouse and can be disabled (dependent select)', async () => {
    const { rerender } = render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'City' });
    await userEvent.click(input);
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.click(screen.getByRole('option', { name: 'Bakı' }));
    expect(input).toHaveValue('Bakı');
    rerender(<Harness disabled />);
    expect(screen.getByRole('combobox', { name: 'City' })).toBeDisabled();
  });
});

describe('Checkbox', () => {
  it('toggles and links its error', async () => {
    const { container } = render(<Checkbox label="I agree" error="You must agree" />);
    const box = screen.getByRole('checkbox', { name: 'I agree' });
    await userEvent.click(box);
    expect(box).toBeChecked();
    expect(box).toHaveAccessibleDescription('You must agree');
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('FileDropzone', () => {
  it('accepts files of the right type and rejects the rest', async () => {
    const onFiles = vi.fn();
    const { container } = render(
      <FileDropzone label="Upload" accept=".csv" maxSizeBytes={10} multiple onFiles={onFiles} />,
    );
    const input = container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('no input');
    const ok = new File(['a,b'], 'ok.csv', { type: 'text/csv' });
    const big = new File(['a,b,c,d,e,f,g,h,i,j,k'], 'big.csv', { type: 'text/csv' });
    const wrong = new File(['x'], 'x.png', { type: 'image/png' });
    await userEvent.upload(input, [ok, big, wrong], { applyAccept: false });
    expect(onFiles).toHaveBeenCalledWith([ok]);
    expect(screen.getByText('big.csv is too large')).toBeInTheDocument();
    expect(screen.getByText('x.png has an unsupported type')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('handles drag and drop', () => {
    const onFiles = vi.fn();
    render(<FileDropzone label="Upload" onFiles={onFiles} />);
    const file = new File(['x'], 'a.txt', { type: 'text/plain' });
    const zone = screen.getByText('Upload').closest('label');
    if (!zone) throw new Error('no zone');
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [file] } });
    zone.dispatchEvent(drop);
    expect(onFiles).toHaveBeenCalledWith([file]);
  });
});

describe('Dialog / ConfirmDialog', () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Open</button>
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          title="Edit"
          actions={<Button onClick={() => setOpen(false)}>Done</Button>}
        >
          <input aria-label="Field" />
        </Dialog>
      </>
    );
  }

  it('traps focus, closes on Escape and restores focus (keyboard only)', async () => {
    const { baseElement } = render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open' });
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'Edit' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(await axe(baseElement)).toHaveNoViolations();
    // Order: close ×, field, Done. Tab cycles and never leaves the dialog.
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByLabelText('Field')).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Done' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Done' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('ConfirmDialog focuses Cancel first and reports choices', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { baseElement } = render(
      <ConfirmDialog
        open
        title="Delete?"
        message="Cannot be undone"
        destructive
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(await axe(baseElement)).toHaveNoViolations();
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    expect(onConfirm).toHaveBeenCalledOnce();
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

describe('Table', () => {
  it('renders rows in a focusable scroll region with a sticky header', async () => {
    const { container } = render(
      <Table
        caption="People"
        rows={[
          { id: '1', name: 'Əli' },
          { id: '2', name: 'Vüsal' },
        ]}
        getRowKey={(r) => r.id}
        columns={[{ key: 'name', header: 'Name', cell: (r) => r.name }]}
      />,
    );
    expect(screen.getByRole('table', { name: 'People' })).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(3);
    const region = screen.getByRole('region', { name: 'Table: People' });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(region).toHaveClass('overflow-auto');
    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveClass('sticky');
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Pagination', () => {
  it('is keyboard operable and respects disabled ends', async () => {
    const onNext = vi.fn();
    const onPrevious = vi.fn();
    const { container } = render(
      <Pagination hasPrevious={false} hasNext onPrevious={onPrevious} onNext={onNext} />,
    );
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Previous/ })).toBeDisabled();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: /Next/ })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onNext).toHaveBeenCalledOnce();
    expect(onPrevious).not.toHaveBeenCalled();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Badge, Spinner, Skeleton, EmptyState, ErrorState', () => {
  it('render without axe violations', async () => {
    const { container } = render(
      <>
        <Badge tone="success">active</Badge>
        <Spinner />
        <Skeleton className="h-4 w-4" />
        <EmptyState description="Nothing" action={<Button>Add</Button>} />
      </>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    expect(screen.getByText('No data')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('ErrorState shows the requestId and a retry button', async () => {
    const onRetry = vi.fn();
    const { container } = render(
      <ErrorState message="Failed to load" requestId="req_42" onRetry={onRetry} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Request ID: req_42');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Toast', () => {
  function Trigger() {
    const toast = useToast();
    return (
      <>
        <button onClick={() => toast.show('Saved', 'success')}>ok</button>
        <button onClick={() => toast.show('Failed', 'error')}>bad</button>
      </>
    );
  }

  it('announces toasts and dismisses them', async () => {
    const { container } = render(
      <ToastProvider durationMs={60000}>
        <Trigger />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'ok' }));
    await userEvent.click(screen.getByRole('button', { name: 'bad' }));
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    expect(screen.getByRole('alert')).toHaveTextContent('Failed');
    expect(await axe(container)).toHaveNoViolations();
    const dismissers = screen.getAllByRole('button', { name: 'Dismiss notification' });
    expect(dismissers).toHaveLength(2);
    for (const d of dismissers) await userEvent.click(d);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('auto-dismisses after the duration', async () => {
    render(
      <ToastProvider durationMs={30}>
        <Trigger />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'ok' }));
    expect(screen.getByRole('status')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });
});
