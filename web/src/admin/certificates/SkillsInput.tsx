import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, FormField } from '@/components';
import { controlClass } from '@/components/cx';
import {
  codePointLength,
  normalizeText,
  SKILL_MAX,
  SKILLS_MAX_ITEMS,
} from '@/lib/certificateContent';

/**
 * Chip input: Enter, comma or leaving the field adds the typed skill; duplicates (case-insensitive)
 * are ignored; at most 10 skills of 40 characters. Each chip has a remove button.
 */
export function SkillsInput({
  label,
  value,
  onChange,
  error,
  disabled,
}: {
  label: string;
  value: readonly string[];
  onChange: (skills: string[]) => void;
  error?: string | undefined;
  disabled?: boolean;
}) {
  const { t } = useTranslation('admin');
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  function commit(raw: string) {
    const skill = normalizeText(raw);
    if (skill === '') {
      setDraft('');
      setProblem(null);
      return;
    }
    if (codePointLength(skill) > SKILL_MAX) {
      setProblem(t('certificates.issueForm.errors.skillTooLong', { max: SKILL_MAX }));
      return;
    }
    if (value.some((s) => s.toLowerCase() === skill.toLowerCase())) {
      setDraft('');
      setProblem(null);
      return;
    }
    if (value.length >= SKILLS_MAX_ITEMS) {
      setProblem(t('certificates.issueForm.errors.tooManySkills', { max: SKILLS_MAX_ITEMS }));
      return;
    }
    onChange([...value, skill]);
    setDraft('');
    setProblem(null);
  }

  const hint = t('certificates.issueForm.skillsHint', {
    count: value.length,
    max: SKILLS_MAX_ITEMS,
    limit: SKILL_MAX,
  });
  const counter =
    draft === ''
      ? ''
      : ` ${t('certificates.issueForm.counter', { current: codePointLength(normalizeText(draft)), max: SKILL_MAX })}`;

  return (
    <FormField label={label} hint={`${hint}${counter}`} error={problem ?? error}>
      {(control) => (
        <div className="flex flex-col gap-2">
          {value.length > 0 ? (
            <ul
              aria-label={t('certificates.issueForm.skillsList')}
              className="flex flex-wrap gap-2"
            >
              {value.map((skill) => (
                <li
                  key={skill}
                  className="inline-flex items-center gap-1 rounded-control border border-line bg-surface-muted pl-3"
                >
                  <span>{skill}</span>
                  <Button
                    variant="ghost"
                    disabled={disabled}
                    aria-label={t('certificates.issueForm.skillRemove', { skill })}
                    onClick={() => onChange(value.filter((s) => s !== skill))}
                  >
                    <span aria-hidden="true">×</span>
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex gap-2">
            <input
              {...control}
              type="text"
              value={draft}
              disabled={disabled}
              autoComplete="off"
              className={controlClass}
              onChange={(event) => {
                setDraft(event.target.value);
                setProblem(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ',') {
                  event.preventDefault();
                  commit(draft);
                }
              }}
              onBlur={() => {
                if (draft !== '') commit(draft);
              }}
            />
            <Button
              variant="secondary"
              disabled={disabled || draft === ''}
              onClick={() => commit(draft)}
            >
              {t('certificates.issueForm.skillAdd')}
            </Button>
          </div>
        </div>
      )}
    </FormField>
  );
}
