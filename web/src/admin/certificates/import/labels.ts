import type { TFunction } from 'i18next';
import type { ColumnId } from '@/lib/bulk';

/** Translated column title; written out so the i18n check can see every key. */
export function columnLabel(t: TFunction, id: ColumnId): string {
  switch (id) {
    case 'ownerName':
      return t('admin:certificates.importWizard.preview.columns.ownerName');
    case 'email':
      return t('admin:certificates.importWizard.preview.columns.email');
    case 'subject':
      return t('admin:certificates.importWizard.preview.columns.subject');
    case 'skills':
      return t('admin:certificates.importWizard.preview.columns.skills');
    case 'issuedAt':
      return t('admin:certificates.importWizard.preview.columns.issuedAt');
  }
}
