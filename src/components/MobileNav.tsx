import { Home, LayoutGrid, Search, Clapperboard } from 'lucide-react';
import type { NavTarget } from './Navbar';

interface MobileNavProps {
  activeTarget: NavTarget;
  onNavigate: (target: NavTarget) => void;
  searchOpen: boolean;
  onSearch: () => void;
  isInLiveRoom: boolean;
}

/** Bottom navigation for phones (the top links are hidden there) */
export function MobileNav({ activeTarget, onNavigate, searchOpen, onSearch, isInLiveRoom }: MobileNavProps) {
  const item = (active: boolean) =>
    `flex flex-1 flex-col items-center gap-1 py-2 text-[10.5px] transition-colors ${active ? 'text-gold' : 'text-ash hover:text-ivory'}`;
  return (
    <nav
      aria-label="Mobile"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-bronze-soft bg-ink/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
    >
      <div className="mx-auto flex max-w-md">
        <button type="button" className={item(activeTarget === 'home' && !searchOpen)} onClick={() => onNavigate('home')}>
          <Home className="h-5 w-5" aria-hidden="true" />
          Home
        </button>
        <button type="button" className={item(activeTarget === 'categories' && !searchOpen)} onClick={() => onNavigate('categories')}>
          <LayoutGrid className="h-5 w-5" aria-hidden="true" />
          Categories
        </button>
        <button type="button" className={item(searchOpen)} onClick={onSearch} aria-expanded={searchOpen}>
          <Search className="h-5 w-5" aria-hidden="true" />
          Search
        </button>
        <button type="button" className={item(activeTarget === 'room')} onClick={() => onNavigate('room')}>
          <span className="relative">
            <Clapperboard className="h-5 w-5" aria-hidden="true" />
            {isInLiveRoom && <span className="absolute -right-1 -top-0.5 h-2 w-2 rounded-full bg-success ring-2 ring-ink" />}
          </span>
          My Room
        </button>
      </div>
    </nav>
  );
}
