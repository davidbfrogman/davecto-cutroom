# lutmatch: how to do this work

The user brings inspiration shots and wants LUTs for their own log footage that look like them. This
folder is standalone (it is not part of the Cutroom app; don't wire it into Cutroom). Run everything
through `./lm` (it uses `.venv`; `./setup.sh` makes it). `README.md` has the commands.

**The rule: every number comes from a measurement.** No hand-tuned colours. If a result looks wrong,
find the measurement or the rule that's wrong, fix that, and say what you changed. The user can't
judge a slider value; they can judge "the white wall in your shot lands where their white wall does".

## Before you start

1. **Find out what the user's footage is.** `./lm probe clip.mov` plus `exiftool -VideoRecordingMode`
   (an X-T5 says `F-log2`). Ask for a card original: AirDrop/Photos copies are 8-bit re-encodes
   tagged bt709, though the levels inside are still log. If the profile is unknown, use a white wall
   and a face in the same light: wall ÷ skin reflectance should be about 2.4. F-Log2 gave 2.4 on this
   user's clip; F-Log gave 1.9.
2. **LUT input** is what an NLE hands a LUT: legal-range video normalised so code 64 → 0, 940 → 1.
   Fujifilm's formula is in code/1023, so `flog.lut_input_to_signal` puts the offset back. ffmpeg's
   `lut3d` sees the same thing, so `ffmpeg -vf lut3d=...` is a faithful test.
3. **Prefer video frames to screenshots.** Mac screenshots are Display P3; `media.to_srgb` converts
   via the embedded profile, but downloading the reel (`sources.url`, yt-dlp) is cleaner.

## The method (one family = one set of reference shots)

1. `./lm new <family>`, then fill in `look.json`: `sources`, `frames` (fps, optional start/duration per
   source), `crop` (the picture inside any frame or border: `ffmpeg -vf cropdetect`, then inset past
   rounded corners), `ignore_rows` (caption band, in crop coordinates), `stats.skip` (frames that
   aren't graded footage: screen recordings, text cards).
2. `./lm frames <family>`. View `work/grids/index.png` to see every shot, then open gridded frames
   (`work/grids/<frame>.png`, 100 px grid in crop coordinates) to place boxes.
3. **Patches** in `look.json` (`frame`, `box` [x0,y0,x1,y1] in crop coords, `label`, `role`):
   - `neutral`: things that are white, grey or black in real life: white tees, walls, plates, bowls,
     keyboards, overcast sky, concrete, black clothing. Aim for 15+ across many lightness levels.
     Mark metal `"metal": true` (it mirrors the room; it's measured but left out). Mark 3–6 whites in
     good light `"white_anchor": true` (sets where 90% reflectance lands).
   - `skin`: faces, hands, arms from several shots. Mark the frontally key-lit ones
     `"skin_anchor": true` (sets where 36% reflectance lands).
   - Boxes go wrong more often than you'd think (wrong frame, a hand instead of a cup, the shadow
     next to the shirt). **Always run `./lm boxes <family>` and look at `work/grids/boxes.png`**, and
     sanity-check the printed RGB: a "white tee" reading (34,34,28) is in shadow or off target.
4. `./lm measure <family>` writes `measured.json`: black floor and white ceiling (lightness
   percentiles), the cast on neutrals against lightness (quadratic in OKLab; residual about 0.01 is
   normal), saturation ceilings per lightness × hue, and graded skin.
5. `./lm build <family>`. It reads only `look.json`, `measured.json` and the camera profile.
6. `./lm check <family> clip@t ...` on the user's footage. Look at it, and measure skin
   (vectorscope angle, aim for the reference's: ~124–132° here) and a white wall (should land on the
   reference cast). Show the user `luts/check.png`.

## Variants: is it a different grade, or different light?

When some shots feel different (warmer, bluer), measure their neutrals against the family's cast
before building anything.
- **Neutrals sit on the cast**: same grade, different light. Make a `"kind": "wb"` look whose
  `targets` are a neutral surface in that light (sunlit concrete → warm; a daylight-lit wall in a
  night shot → blue hour). The white-balance shift is solved to land there exactly. Here, the
  "warm" shots' whites were *less* yellow than the cast: the warmth was sun on orange parquet, so a
  cast-offset variant came out identical to the base. Anchoring on the sunlit tiles fixed it.
- **Neutrals don't sit on the cast**: it's another grade. Start a new family.
- **Pick targets lit only by the light you mean.** In the night shot, the sofa was next to a
  tungsten lamp and another wall patch was near black; only the far wall was clean daylight.
- **If the shift kills skin, add `skin_key`.** A cool shift turned daylight-lit skin grey (chroma
  0.006). The reference's face stayed on the skin line, and its lamps stayed warm, so a skin key keeps
  skin, wood and lamp hues on the base rendering. Record the evidence patches you used to decide.
- **No reference at all** (a clean or neutral look): `"kind": "clean"`, defined by standards
  (neutral greys, 123° skin line, 18% grey at 42 IRE, 90% white at 90 IRE).

## The user's camera

`cameras/<id>.json` holds 10-bit skin code values from the user's own log clips, each with a white
or grey in the same light where possible (`./lm camera-frame`, then `./lm camera-add`). The build
white-balances each sample against its neutral, then solves a hue rotation and chroma gain so the
graded skin lands on the reference's graded skin, cast included. Matching the cast-removed hue
instead left this user's skin 5–10° too yellow, because their skin is brighter than the
reference's and the cast grows with lightness. More samples, from different light, give a steadier
fit: 10 here, across 4 clips.

## Things that bit last time

- Auto white balance varies shot to shot. Sunlit walls came out yellow under the olive cast, so
  tell the user to set a fixed Kelvin white balance.
- The reference looks have steep shadows (contrast about 2.2), so clips a stop under go very dark.
  Measure scene reflectance of a known white in the clip (`flog.decode`) and say how many stops to
  add before the LUT.
- Skin-key looks change fast with hue. 33-point cubes averaged 0.9 codes off there, 65-point 0.6.
  Ship both.
- Check cube accuracy with full-resolution frames on both sides. Comparing a bicubic-downscaled
  frame against a decimated one fakes big errors at edges.

## Changing the code

`./lm test` must pass. `test_rebuild_matches_committed_cubes` fails on any change that alters a LUT.
If the change is intended, rebuild (`./lm build olive-teal`), check the result, commit the new cubes,
and say what moved. Keep `measured.json` committed: it's what makes `build` reproducible without the
reels. Reels and frames stay in `work/`, which isn't committed.
