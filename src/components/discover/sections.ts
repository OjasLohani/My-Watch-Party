import type { NavTarget } from '../Navbar';

/** Section ids on the discover page and the navigation entry each belongs to */
export const SECTIONS: { id: string; target: NavTarget }[] = [
  { id: 'home', target: 'home' },
  { id: 'now-showing', target: 'movies' },
  { id: 'library', target: 'categories' },
  { id: 'my-list', target: 'mylist' },
];

export const SECTION_FOR_TARGET: Partial<Record<NavTarget, string>> = Object.fromEntries(
  SECTIONS.map((s) => [s.target, s.id]));

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
}
