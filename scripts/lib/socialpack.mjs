import { config } from './config.mjs';
import { videoScript, imagePrompts, caption, hashtags, schedule, roundupScript } from './copy.mjs';
import { lintCaption, lintCopy } from './compliance.mjs';
import { slugify } from './store.mjs';
import { fullName } from './normalise.mjs';

/**
 * Build a SocialPack from exactly `config.social.packSize` approved watches.
 *
 * The pack is a work order, not a publishing action. Nothing here posts
 * anything anywhere: it produces scripts, prompts, captions, hashtags and a
 * calendar, and a human uploads them. That boundary is deliberate.
 */
export function buildPack(watches, opts = {}) {
  const size = config.social.packSize;
  if (!Array.isArray(watches) || watches.length !== size) {
    throw new Error(`A pack needs exactly ${size} watches; got ${watches?.length ?? 0}.`);
  }

  const createdAt = opts.createdAt || new Date().toISOString();
  const id = opts.id || `pack-${createdAt.slice(0, 10)}-${slugify(opts.title || 'top-five').slice(0, 24)}`;
  const title = opts.title || `Top ${size}: ${createdAt.slice(0, 10)}`;
  const startDate = opts.startDate ? new Date(opts.startDate) : new Date(createdAt);

  const video_scripts = [];
  const image_prompts = [];
  const captions = [];
  const hashtag_sets = [];

  watches.forEach((w, i) => {
    for (const platform of config.social.platforms) {
      video_scripts.push(videoScript(w, platform, i));
      captions.push({ watch_id: w.id, asin: w.asin, ...caption(w, platform) });
    }
    image_prompts.push({ watch_id: w.id, asin: w.asin, prompts: imagePrompts(w) });
    hashtag_sets.push({ watch_id: w.id, asin: w.asin, tags: hashtags(w) });
  });

  const posting_schedule = schedule(watches, startDate);

  // Lint everything before it leaves the building.
  const issues = [];
  for (const c of captions) {
    for (const i of lintCaption(c.text)) issues.push({ where: `caption/${c.asin}/${c.platform}`, ...i });
  }
  for (const s of video_scripts) {
    for (const line of [s.hook.line, ...s.beats.map((b) => b.line), s.cta.line]) {
      for (const i of lintCopy(line, { context: 'script' })) issues.push({ where: `script/${s.asin}/${s.platform}`, ...i });
    }
  }

  return {
    id,
    title,
    created_at: createdAt,
    tone: config.social.tone,
    selected_watch_ids: watches.map((w) => w.id),
    selected_asins: watches.map((w) => w.asin),
    ranking: watches.map((w, i) => ({ rank: i + 1, watch_id: w.id, asin: w.asin, label: fullName(w) })),
    video_scripts,
    roundup_script: roundupScript(watches),
    image_prompts,
    captions,
    hashtags: hashtag_sets,
    posting_schedule,
    compliance: {
      checked_at: createdAt,
      rules_applied: config.compliance.trademarkRules,
      issues,
      clean: issues.filter((i) => i.level === 'error').length === 0,
    },
    manual_step: 'A human uploads these to TikTok, Instagram and YouTube. Nothing in this repository posts to any platform.',
  };
}

/** Human-readable companion so the pack can be worked from without a JSON viewer. */
export function packToMarkdown(pack) {
  const L = [];
  L.push(`# ${pack.title}`, '');
  L.push(`Generated ${pack.created_at.slice(0, 16).replace('T', ' ')} · tone: ${pack.tone}`, '');
  L.push(`> ${pack.manual_step}`, '');

  L.push('## Ranking', '');
  for (const r of pack.ranking) L.push(`${r.rank}. ${r.label}`);
  L.push('');

  L.push('## Posting schedule', '');
  L.push('| # | Date | Time | Type | What |');
  L.push('|---|------|------|------|------|');
  for (const s of pack.posting_schedule) L.push(`| ${s.slot} | ${s.date} | ${s.time_local} | ${s.type} | ${s.label} |`);
  L.push('');

  for (const r of pack.ranking) {
    const scripts = pack.video_scripts.filter((s) => s.asin === r.asin);
    const caps = pack.captions.filter((c) => c.asin === r.asin);
    const imgs = pack.image_prompts.find((p) => p.asin === r.asin);
    const tags = pack.hashtags.find((h) => h.asin === r.asin);

    L.push(`---`, '', `## ${r.rank}. ${r.label}`, '');

    for (const s of scripts) {
      L.push(`### ${s.platform_name} — ${s.target_seconds}s script`, '');
      L.push(`*${s.direction}*`, '');
      L.push(`- **${s.hook.at}** ${s.hook.line}  \n  on screen: \`${s.hook.onScreen}\``);
      for (const b of s.beats) L.push(`- **${b.at}** ${b.line}  \n  on screen: \`${b.onScreen}\``);
      L.push(`- **${s.cta.at}** ${s.cta.line}  \n  on screen: \`${s.cta.onScreen}\``);
      L.push('');
      L.push(`Shot notes:`);
      for (const n of s.shot_notes) L.push(`- ${n}`);
      L.push('');
    }

    L.push('### Captions', '');
    for (const c of caps) {
      L.push(`**${c.platform}** (${c.length}/${c.limit} chars)`, '', '```', c.text, '```', '');
    }

    L.push('### Image prompts', '');
    L.push('_Backgrounds only. Never generate a synthetic photo of the watch itself._', '');
    for (const p of imgs?.prompts || []) {
      L.push(`- **${p.purpose}** — ${p.prompt}`, `  - negative: ${p.negative}`, `  - ${p.note}`);
    }
    L.push('');

    L.push('### Hashtags', '');
    L.push((tags?.tags || []).join(' '), '');
  }

  L.push('---', '', '## Roundup video', '');
  const rs = pack.roundup_script;
  L.push(`- **${rs.hook.at}** ${rs.hook.line}`);
  for (const b of rs.beats) L.push(`- **${b.at}** ${b.line}`);
  L.push(`- **${rs.cta.at}** ${rs.cta.line}`, '');

  L.push('## Compliance', '');
  L.push(pack.compliance.clean ? 'No blocking issues.' : `${pack.compliance.issues.length} issue(s) found:`);
  for (const i of pack.compliance.issues) L.push(`- [${i.level}] ${i.where}: ${i.detail}`);
  L.push('');
  for (const r of pack.compliance.rules_applied) L.push(`- ${r}`);
  L.push('');

  return L.join('\n');
}
