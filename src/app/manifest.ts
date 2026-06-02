import type { MetadataRoute } from 'next';

// Web app manifest — makes Game Arena installable as a standalone app, so it
// opens in its own window (no browser chrome) for maximum screen space.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Game Arena',
    short_name: 'Game Arena',
    description: 'Multiplayer board & card games — Legendary, HeroQuest, Long Shot, Spellduel and more.',
    start_url: '/lobby',
    display: 'standalone',
    orientation: 'any',
    background_color: '#0a0a0a',
    theme_color: '#0a0a0a',
    icons: [
      { src: '/icon-512.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon-512.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ],
  };
}
