// Timing and client-side decisions for automatic host transfer.
//
// The SERVER decides whether the host is disconnected (its lease is older
// than LEASE_TTL_MS) and who becomes host. The client only decides how
// often to renew its own lease and how often to ask the server
// (auto_transfer_host). Nothing here is trusted by the server.
//
// Keep LEASE_TTL_MS equal to wp_lease_ttl() in
// supabase/migrations/20261019120000_stage3b_automatic_host_transfer.sql

/** Every member renews its lease this often */
export const LEASE_RENEW_MS = 4_000;
/** Server-side lease lifetime (must match wp_lease_ttl()) */
export const LEASE_TTL_MS = 12_000;
/** The transfer check loop ticks this often */
export const TRANSFER_CHECK_TICK_MS = 3_000;
/** Other guests (not first in line) ask only every Nth tick… */
export const BACKUP_CHECK_EVERY_TICKS_HOST_OFFLINE = 3;
/** …and while Presence still shows the host, even less often */
export const BACKUP_CHECK_EVERY_TICKS_HOST_ONLINE = 10;

interface MemberLike {
  id: string;
}

/**
 * Best guess of who the server will pick: the first member (in join
 * order) other than the host who is online. That guest asks the server
 * every tick; everyone else asks less often as a backup. Only used to
 * spread the load. The server makes the real choice.
 */
export function pickLikelySuccessor(
  membersInJoinOrder: MemberLike[],
  hostId: string,
  onlineIds: Set<string> | null
): string | null {
  for (const m of membersInJoinOrder) {
    if (m.id === hostId) continue;
    if (!onlineIds || onlineIds.has(m.id)) return m.id;
  }
  return null;
}

/** Should this guest ask the server on this tick (tick counts from 0)? */
export function shouldAskServer(
  tick: number,
  { isLikelySuccessor, hostOnline }: { isLikelySuccessor: boolean; hostOnline: boolean }
): boolean {
  if (isLikelySuccessor) return true;
  const every = hostOnline ? BACKUP_CHECK_EVERY_TICKS_HOST_ONLINE : BACKUP_CHECK_EVERY_TICKS_HOST_OFFLINE;
  return tick % every === 0;
}

/**
 * Expected time from the host disconnecting until hosting is transferred.
 * - `finalRenewalSent`: the tab was closed normally, so the page sent one
 *   last renewal on the way out; the lease then expires exactly 12 s later.
 * - otherwise (crash, power loss, network drop): the last renewal was up
 *   to one renewal interval before the disconnect.
 * After expiry, the first guest in line asks within one check tick, plus
 * one request round trip.
 */
export function transferDelayRangeMs(roundTripMs: number, finalRenewalSent: boolean): { min: number; max: number } {
  const max = LEASE_TTL_MS + TRANSFER_CHECK_TICK_MS + roundTripMs;
  const min = (finalRenewalSent ? LEASE_TTL_MS : LEASE_TTL_MS - LEASE_RENEW_MS) + roundTripMs;
  return { min, max };
}
