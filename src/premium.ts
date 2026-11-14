// Premium scaffolding. Nothing is paywalled yet — this is the single place to
// decide what "premium" means once you're ready to charge or take donations.
//
// Two ways a server can become premium:
//   1. Discord App Subscriptions (Developer Portal > Monetization). Discord includes
//      the server's active entitlements on every interaction automatically.
//   2. Manual: set guild_settings.tier = 'premium' (and optional premium_until)
//      for donors / Ko-fi / Patreon supporters.
import type { Interaction } from './discord';
import type { GuildSettings } from './db';

export type Tier = 'free' | 'premium';

export function getTier(settings: GuildSettings, i: Interaction): Tier {
  const now = Date.now();
  const hasEntitlement = (i.entitlements ?? []).some((e) => !e.ends_at || new Date(e.ends_at).getTime() > now);
  if (hasEntitlement) return 'premium';
  if (settings.tier === 'premium' && (!settings.premium_until || new Date(settings.premium_until).getTime() > now)) {
    return 'premium';
  }
  return 'free';
}

// Feature flags per tier. Flip a value to false under `free` to paywall it later.
export const FEATURES = {
  free: { categoryFilter: true, adultContent: true, votes: true },
  premium: { categoryFilter: true, adultContent: true, votes: true },
} satisfies Record<Tier, Record<string, boolean>>;

export function hasFeature(tier: Tier, feature: keyof (typeof FEATURES)['free']): boolean {
  return FEATURES[tier][feature];
}
