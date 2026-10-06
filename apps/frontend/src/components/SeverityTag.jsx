/**
 * Coloured pill for CRITICAL / HIGH / MEDIUM / LOW severity labels.
 * Reused in Scan, Mask, and Audit pages.
 */

const CLASS_MAP = {
  CRITICAL : 'tag tag-critical',
  HIGH     : 'tag tag-high',
  MEDIUM   : 'tag tag-medium',
  LOW      : 'tag tag-low',
};

export default function SeverityTag({ severity }) {
  const cls = CLASS_MAP[severity] ?? 'tag';
  return <span className={cls}>{severity}</span>;
}