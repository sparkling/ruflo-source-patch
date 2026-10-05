// Exact reviewed executable boundaries, never a version-based success claim.
import { createHash } from 'node:crypto';

export function reviewedBoundary(source, start, end, expected) {
  if (source.split(start).length !== 2 || (end !== null && source.split(end).length !== 2)) return false;
  const begin = source.indexOf(start), finish = end === null ? source.length : source.indexOf(end, begin + start.length);
  if (finish < 0) return false;
  const digest = createHash('sha256').update(source.slice(begin, finish)).digest('hex');
  return (Array.isArray(expected) ? expected : [expected]).includes(digest);
}
