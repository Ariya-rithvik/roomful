Fonts bundled with the Roomcaption TV app

All files are under the SIL Open Font License 1.1 (licence text next to each family below).
Downloaded 2026-10-17 from the official Google Fonts repository, github.com/google/fonts (main):

  ofl/baloo2/Baloo2[wght].ttf                              -> OFL-Baloo2.txt
  ofl/notosans/NotoSans[wdth,wght].ttf                     -> OFL-NotoSans.txt
  ofl/notosansdevanagari/NotoSansDevanagari[wdth,wght].ttf -> OFL-NotoSansDevanagari.txt
  ofl/notosanstamil/NotoSansTamil[wdth,wght].ttf           -> OFL-NotoSansTamil.txt

The repository only ships variable fonts for these families. React Native on Android does not pick
weights reliably from a variable font, so static instances were made with fontTools
(fontTools.varLib.instancer.instantiateVariableFont, updateFontNames=True; wdth=100 where present):

  Baloo2-Bold (700), Baloo2-ExtraBold (800)
  NotoSans-Regular (400), NotoSans-SemiBold (600), NotoSans-Bold (700)
  NotoSansDevanagari-Regular (400), NotoSansDevanagari-SemiBold (600), NotoSansDevanagari-Bold (700)
  NotoSansTamil-Regular (400), NotoSansTamil-SemiBold (600), NotoSansTamil-Bold (700)

None of these families declares a Reserved Font Name. SpaceMono-Regular.ttf and OFL.txt came with
Amazon's multi-TV starter template.

Each weight is registered under its own family name in apps/expo-multi-tv/App.tsx; screens pick
the family with fontFor(lang, weight) in packages/shared-ui/src/rc/theme.ts.
