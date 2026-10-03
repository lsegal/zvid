import { expect, type Page, test } from "@playwright/test";

// The zvid opening sample: File → Open Sample, and the sample opened on an
// empty start (`?sample=1`, since automation turns it off by default). The
// sample opens at once and its media downloads from the app's own origin
// into the media cache in place, through the same skeletons, status and
// Media Sync dialog as media syncing from a peer.
const SAMPLE_MEDIA = "**/samples/opening-v2/*";
const MUSIC_TRACK = "source-music";
const MUSIC_ID = "zvid-sample:opening-v2:music";
// The Audio layer plays the music as 20 two-beat selections.
const MUSIC_SELECTIONS = 20;

// Each load reads about 15 MB of media and analyzes it.
test.describe.configure({ timeout: 120_000 });

// Records the analysers the preview's mixer makes, which hear the mix.
async function probeAnalysers(page: Page) {
  await page.addInitScript(() => {
    const probe = window as unknown as { analysers: AnalyserNode[] };
    probe.analysers = [];
    const createAnalyser = AudioContext.prototype.createAnalyser;
    AudioContext.prototype.createAnalyser = function (this: AudioContext) {
      const analyser = createAnalyser.call(this);
      probe.analysers.push(analyser);
      return analyser;
    };
  });
}

// The mix's loudest RMS level over a few reads of the latest analyser, so a
// read between buffers doesn't count.
async function mixLevel(page: Page) {
  let level = 0;
  for (let read = 0; read < 6; read += 1) {
    level = Math.max(
      level,
      await page.evaluate(() => {
        const probe = window as unknown as { analysers: AnalyserNode[] };
        const analyser = probe.analysers.at(-1);
        if (!analyser) {
          return 0;
        }
        const samples = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(samples);
        let total = 0;
        for (const sample of samples) {
          total += sample * sample;
        }
        return Math.sqrt(total / samples.length);
      }),
    );
    await page.waitForTimeout(50);
  }
  return level;
}

async function openFileMenu(page: Page) {
  await page.getByRole("menuitem", { name: "File", exact: true }).click();
  await expect(page.getByRole("menu").first()).toBeVisible();
}

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

async function expectSampleOpen(page: Page) {
  await expect(page.getByText("Media linked")).toBeVisible({
    timeout: 60_000,
  });
  for (const id of [
    "orbit",
    "ribbon",
    "corridor",
    "order",
    "fx-regions",
    "audio",
  ]) {
    await expect(lane(page, id)).toHaveCount(1);
  }
  // The Audio layer plays the music from its source track as two-beat
  // selections, so the Audio row shows the mix of the layers: the music.
  await expect(
    page.locator(`[data-source-track-label-id="${MUSIC_TRACK}"]`),
  ).toContainText("Music");
  await expect(page.locator("[data-audio-row]")).toContainText(
    `From layers · ${MUSIC_SELECTIONS} clips`,
  );
  await expect(
    page.getByRole("menuitem", { name: /Locate Offline Media/ }),
  ).toHaveCount(0);
}

test("File → Open Sample opens the editable sample with all its media", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("No source media yet")).toBeVisible();

  await openFileMenu(page);
  await page.getByRole("menuitem", { name: "Open Sample" }).click();
  await expectSampleOpen(page);
  await expect(
    page.getByText("zvid opening sample", { exact: true }).first(),
  ).toBeVisible();

  // A refresh restores the sample from the autosave and the media cache.
  await page.reload();
  await expectSampleOpen(page);
});

test("the sample plays its music through the clip mix", async ({ page }) => {
  await probeAnalysers(page);
  await page.goto("/?sample=1");
  await expectSampleOpen(page);

  // The Audio row draws the music's waveform.
  const mix = page.locator("[data-audio-row] [data-audio-mix]");
  await expect(mix).toHaveAttribute("data-audio-mix", "ready", {
    timeout: 30_000,
  });
  expect(
    Number(await mix.getAttribute("data-audio-mix-level")),
  ).toBeGreaterThan(0);

  // The mix is audible once playback is past the music's 0.6 s fade-in.
  await page.getByRole("button", { name: "Play timeline" }).click();
  await expect
    .poll(() => mixLevel(page), { timeout: 20_000 })
    .toBeGreaterThan(0.02);
  await page.getByRole("button", { name: "Pause playback" }).click();
});

// The Audio layer's selections each play the music where it is in the file,
// each through its own audio effect. With those effects bypassed, the mix
// hits on the same beats the music does, so the selections play it in time
// and audio-reactive effects follow it; with them on, every selection but
// the first, clean one sounds different.
test("the Audio layer plays the music in time through its effects", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  const { bypassedHits, musicHits, sectionChanges } = await page.evaluate(
    async ({ musicId, sections }) => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const [
        { OPENING_SAMPLE },
        { buildSampleOpenPayload },
        { sessionToProject },
        { buildFallbackMediaItem },
        { PALETTE },
        { resolveAudioClips },
        { renderAudioMixOffline },
        { audioMixEndSeconds },
        { OfflineAudioBands },
        { isAudioEffectName },
      ] = await Promise.all([
        load("/src/sample/opening-sample.ts"),
        load("/src/sample/sample-loader.ts"),
        load("/src/app/session-project.ts"),
        load("/src/media.ts"),
        load("/src/app/constants.ts"),
        load("/src/audio-mix/resolve.ts"),
        load("/src/audio-mix/offline.ts"),
        load("/src/audio-mix/mix.ts"),
        load("/src/fx-shaders/audio-bands.ts"),
        load("/src/fx-registry.ts"),
      ]);
      const sampleRate = 48_000;
      const asset = OPENING_SAMPLE.manifest.assets.find(
        (candidate: { id: string }) => candidate.id === musicId,
      );
      const payload = buildSampleOpenPayload(
        OPENING_SAMPLE.manifest,
        OPENING_SAMPLE.sessionText,
      );
      const media = payload.mediaRefs.map((ref: unknown) =>
        buildFallbackMediaItem(ref, PALETTE[0]),
      );
      const project = sessionToProject(payload.session, media);
      type Effect = { effectName: string; enabled?: boolean };
      const render = async (effects: Effect[]) => {
        const mix = resolveAudioClips({
          clips: project.arrangementClips,
          lanes: project.lanes,
          sourceTracks: project.sourceTracks,
          sourceSpans: project.sourceSpans,
          mediaById: new Map(
            media.map((item: { id: string }) => [
              item.id,
              { hasAudio: item.id === musicId },
            ]),
          ),
          effects,
          bpm: project.bpm,
        });
        return (await renderAudioMixOffline(
          mix,
          [{ id: musicId, previewUrl: asset.url }],
          {
            sampleRate,
            numberOfChannels: 2,
            startSeconds: 0,
            length: Math.ceil(audioMixEndSeconds(mix) * sampleRate),
          },
        )) as Float32Array[] | undefined;
      };
      const shown = await render(project.effects);
      const bypassed = await render(
        project.effects.map((effect: Effect) =>
          isAudioEffectName(effect.effectName) && effect.effectName !== "Gain"
            ? { ...effect, enabled: false }
            : effect,
        ),
      );
      const context = new OfflineAudioContext(1, 1, sampleRate);
      const music = await context.decodeAudioData(
        await (await fetch(asset.url)).arrayBuffer(),
      );

      // The hits the reactive effects see over the first 10 s, in seconds
      // on the bands' 60 Hz grid.
      const hits = (channels: Float32Array[]) => {
        const bands = OfflineAudioBands.fromChannels(channels, sampleRate);
        const found = new Set<number>();
        for (let tick = 0; tick <= 600; tick += 1) {
          for (const onset of bands.at(tick / 60).onsets ?? []) {
            found.add(Math.round((tick / 60 - onset.secondsAgo) * 60) / 60);
          }
        }
        return [...found].sort((a, b) => a - b);
      };
      // How far each selection's effect moves its sound: the RMS of the
      // difference over the RMS of the music it plays.
      const sectionLength = (30 * sampleRate) / sections;
      const sectionChanges = Array.from({ length: sections }, (_, index) => {
        let difference = 0;
        let level = 0;
        for (let channel = 0; channel < 2; channel += 1) {
          const from = shown?.[channel] ?? new Float32Array();
          const to = bypassed?.[channel] ?? new Float32Array();
          for (
            let sample = index * sectionLength;
            sample < (index + 1) * sectionLength;
            sample += 1
          ) {
            difference += ((from[sample] ?? 0) - (to[sample] ?? 0)) ** 2;
            level += (to[sample] ?? 0) ** 2;
          }
        }
        return level ? Math.sqrt(difference / level) : 0;
      });
      return {
        bypassedHits: bypassed ? hits(bypassed) : [],
        musicHits: hits(
          Array.from({ length: music.numberOfChannels }, (_, channel) =>
            music.getChannelData(channel),
          ),
        ),
        sectionChanges,
      };
    },
    { musicId: MUSIC_ID, sections: MUSIC_SELECTIONS },
  );

  expect(musicHits.length).toBeGreaterThan(0);
  // The first hit is on the music's first beats.
  expect(musicHits[0]).toBeLessThan(3);
  expect(bypassedHits).toEqual(musicHits);
  const [clean, ...changed] = sectionChanges;
  expect(clean).toBeLessThan(1e-4);
  for (const change of changed) {
    expect(change).toBeGreaterThan(0.05);
  }
});

test("an empty start opens the sample on its own", async ({ page }) => {
  await page.goto("/?sample=1");
  await expectSampleOpen(page);
});

test("the sample opens at once and loads its media in place", async ({
  page,
}) => {
  // Hold the media back until the open session has been checked.
  const held: (() => Promise<void>)[] = [];
  let holding = true;
  await page.route(SAMPLE_MEDIA, (route) => {
    if (holding) {
      held.push(() => route.continue());
    } else {
      void route.continue();
    }
  });
  await page.goto("/");
  await openFileMenu(page);
  await page.getByRole("menuitem", { name: "Open Sample" }).click();

  for (const id of ["orbit", "ribbon", "corridor"]) {
    await expect(lane(page, id)).toHaveCount(1);
  }
  await expect(page.locator(".clip-card.is-syncing").first()).toBeVisible();
  const status = page.getByRole("button", {
    name: /^Loading \d+ of \d+ media files…/,
  });
  await expect(status).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await status.click();
  const dialog = page.getByRole("dialog", { name: "Media Sync" });
  await expect(dialog).toContainText("from Sample");
  await expect(dialog).toContainText("loaded");

  holding = false;
  for (const release of held.splice(0)) {
    await release();
  }
  await expectSampleOpen(page);
  await expect(page.locator(".clip-card.is-syncing")).toHaveCount(0);
});

test("a failed download can be retried from the Media Sync dialog", async ({
  page,
}) => {
  let failing = true;
  await page.route(SAMPLE_MEDIA, (route) =>
    failing ? route.abort("internetdisconnected") : route.continue(),
  );
  await page.goto("/");
  await openFileMenu(page);
  await page.getByRole("menuitem", { name: "Open Sample" }).click();

  // The session is open; its media is what failed.
  await expect(lane(page, "orbit")).toHaveCount(1);
  const offline = page.getByRole("button", { name: /offline media files?$/ });
  await expect(offline).toBeVisible({ timeout: 60_000 });
  await offline.click();
  const dialog = page.getByRole("dialog", { name: "Media Sync" });
  await expect(dialog).toContainText("could not be downloaded");

  failing = false;
  const retry = dialog.getByRole("button", { name: "Retry" });
  while ((await retry.count()) > 0) {
    await retry.first().click();
  }
  await expectSampleOpen(page);
});

test("reopening the sample after a failed download tries it again", async ({
  page,
}) => {
  let failing = true;
  await page.route(SAMPLE_MEDIA, (route) =>
    failing ? route.abort("internetdisconnected") : route.continue(),
  );
  await page.goto("/");
  await openFileMenu(page);
  await page.getByRole("menuitem", { name: "Open Sample" }).click();
  await expect(
    page.getByRole("button", { name: /offline media files?$/ }),
  ).toBeVisible({ timeout: 60_000 });

  failing = false;
  await openFileMenu(page);
  await page.getByRole("menuitem", { name: "Close Session" }).click();
  await expect(page.getByText("No source media yet")).toBeVisible();
  await openFileMenu(page);
  await page.getByRole("menuitem", { name: "Open Sample" }).click();
  await expectSampleOpen(page);
});

test("closing the session stops the sample's downloads", async ({ page }) => {
  // Hold the media back so the session can be closed mid-way.
  await page.route(SAMPLE_MEDIA, () => {});
  await page.goto("/");
  await openFileMenu(page);
  await page.getByRole("menuitem", { name: "Open Sample" }).click();
  await expect(lane(page, "orbit")).toHaveCount(1);

  await openFileMenu(page);
  await page.getByRole("menuitem", { name: "Close Session" }).click();
  await expect(page.getByText("No source media yet")).toBeVisible();
  await expect(lane(page, "orbit")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^Loading \d+ of/ }),
  ).toHaveCount(0);
});

test("a saved copy of the sample reopens with its media still linked", async ({
  page,
}) => {
  // Save downloads instead of asking where to save.
  await page.addInitScript(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  await page.goto("/?sample=1");
  await expectSampleOpen(page);

  await openFileMenu(page);
  const downloading = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Save", exact: true }).click();
  const saved = await (await downloading).path();
  expect(saved).toBeTruthy();

  await openFileMenu(page);
  await page.getByRole("menuitem", { name: "Close Session" }).click();
  await expect(page.getByText("No source media yet")).toBeVisible();

  const choosing = page.waitForEvent("filechooser");
  await openFileMenu(page);
  await page.getByRole("menuitem", { name: "Open Session" }).click();
  await (await choosing).setFiles({
    name: "zvid opening sample.lvp",
    mimeType: "application/json",
    buffer: (await import("node:fs")).readFileSync(saved as string),
  });
  await expectSampleOpen(page);
});
