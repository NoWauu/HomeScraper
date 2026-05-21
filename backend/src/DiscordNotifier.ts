import axios from 'axios';
import { RawAd, CommuteTimes } from './types';

export function formatDuration(minutes: number): string {
  if (minutes < 0) return 'N/A';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function mapsTransitUrl(
  originLat: number,
  originLon: number,
  destLat: number,
  destLon: number
): string {
  return (
    `https://www.google.com/maps/dir/?api=1` +
    `&origin=${originLat},${originLon}` +
    `&destination=${destLat},${destLon}` +
    `&travelmode=transit`
  );
}

export class DiscordNotifier {
  constructor(
    private readonly webhookUrl: string,
    private readonly targetLat: number,
    private readonly targetLon: number
  ) {}

  async send(ad: RawAd, commute: CommuteTimes): Promise<void> {
    const originLat = ad.location.latitude;
    const originLon = ad.location.longitude;

    const transitLabel = formatDuration(commute.transitMinutes);
    const transitValue =
      commute.transitMinutes >= 0 && originLat !== undefined && originLon !== undefined
        ? `[${transitLabel}](${mapsTransitUrl(originLat, originLon, this.targetLat, this.targetLon)})`
        : transitLabel;

    const embed = {
      title: `🏠 New listing in ${ad.location.city}`,
      url: ad.url,
      color: 0x00b4d8,
      fields: [
        { name: '💶 Prix', value: `${ad.price.toLocaleString('fr-FR')} €/mois`, inline: true },
        { name: '📐 Surface', value: `${ad.surfaceArea} m²`, inline: true },
        { name: '🚪 Pièces', value: String(ad.rooms), inline: true },
        {
          name: '📍 Localisation',
          value: `${ad.location.city} (${ad.location.zipCode})`,
          inline: false,
        },
        {
          name: '🚗 Voiture',
          value: formatDuration(commute.drivingMinutes),
          inline: true,
        },
        {
          name: '🚶 À pied',
          value: formatDuration(commute.walkingMinutes),
          inline: true,
        },
        {
          name: '🚇 Transit',
          value: transitValue,
          inline: true,
        },
      ],
      footer: {
        text: `Source: ${ad.source} • ${new Date().toLocaleString('fr-FR')}`,
      },
      ...(ad.imageUrl ? { image: { url: ad.imageUrl } } : {}),
    };

    await axios.post(this.webhookUrl, { embeds: [embed] }, { timeout: 10_000 });
  }
}
