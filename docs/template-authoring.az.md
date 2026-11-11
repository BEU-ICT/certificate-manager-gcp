# Şablon hazırlama bələdçisi

English: [template-authoring.md](template-authoring.md). Bu tərcümə ingiliscə mətnin əsasında hazırlanıb; fərq olarsa, ingiliscə mətn düzgün sayılır. Konfiqurasiya cədvəllərində təsvirlər ingiliscə qalır, çünki sxemdən avtomatik yaradılır.

Sertifikat şablonu kiçik bir **paketdir**: SVG dizayn, bir neçə şrift, istəyə görə loqolar və mətnin hansı yerdə, QR kodun harada çap olunacağını göstərən bir `config.json`. Bu bələdçi dizayn faylından yüklənmiş şablona qədər yolu izah edir. Paketi `svg-pdf` mühərriki PDF-ə çevirir, buna görə burada yazdığınız dəyərlər çapda eynilə görünür.

Hazır nümunədən başlayın: `docs/templates/reference/` (A4 üfüqi), `docs/templates/portrait/` (şaquli) və ya `docs/templates/minimal/` qovluğunu kopyalayıb dəyişin. Bax: [docs/templates/README.md](templates/README.md).

## 1. Paketin quruluşu

```text
my-template/
├── config.json        məcburi: yerləşdirmə və seçimlər
├── background.svg     məcburi: dizayn, A4, canlı mətn olmadan
├── fonts/
│   └── Name.ttf       ən azı bir TrueType şrift
└── assets/
    └── logo.png       istəyə görə PNG və ya JPEG şəkillər
```

Yükləmə zamanı yoxlanan qaydalar:

- Yalnız bu yollar ola bilər: `config.json`, `background.svg`, `fonts/<ad>.ttf` və `assets/<ad>.png|jpg|jpeg`. Fayl adlarında hərf, rəqəm, `.`, `_`, `-` işlədin, ən çoxu 100 simvol; yalnız böyük/kiçik hərflə fərqlənən iki ad qəbul olunmur.
- `fonts/` və `assets/` xaricində alt qovluq, link və başqa fayl tipləri olmaz.
- Limitlər [11-ci bölmədə](#11-limitlər) verilib.
- `fonts/LICENSE.txt` kimi lisenziya faylı yaxşıdır. Yoxlayıcı onu `UNREFERENCED_FILE` xəbərdarlığı kimi göstərir; bu normaldır.

Yüklənmiş paket **dəyişməzdir**. Dizaynı dəyişmək üçün yeni versiya yükləyirsiniz (9-cu bölmə).

## 2. Koordinat sistemi

`config.json`-dakı bütün ədədlər **PDF nöqtələridir** (1 pt = 1/72 düym = 0,3528 mm).

- A4 üfüqi **841,89 × 595,28 pt**, A4 şaquli **595,28 × 841,89 pt**-dir.
- Başlanğıc `(0, 0)` səhifənin **sol yuxarı** küncüdür, **y aşağıya doğru artır**.
- Mətn sahəsi qutudur: `x`, `y` onun sol yuxarı küncü, `width` eni, hündürlüyü isə `maxLines × size × lineHeight`-dır. Mətn qutunun içində sətirlərə bölünür və qutunun hamısı səhifənin içində olmalıdır.
- QR kod kvadratdır: sol yuxarı küncü `qr.x`, `qr.y`, tərəfi `qr.size`.
- Çevirmə: 1 mm = 2,835 pt, 1 sm = 28,35 pt, 96 DPI-də 1 px = 0,75 pt.

## 3. Dizaynın ixracı (`background.svg`)

Fon bütün sertifikatlarda eyni olan hər şeyi saxlayır: haşiyə, bəzək, başlıqlar, etiketlər, imza xətləri. Ad, tarix və QR kodu mühərrik üstünə çəkir.

Tələblər:

1. **Səhifə ölçüsü.** SVG `viewBox`-un nisbəti seçilmiş istiqamətin A4 nisbətinə uyğun olmalıdır, ideal olaraq tam `0 0 841.89 595.28` (üfüqi) və ya `0 0 595.28 841.89` (şaquli). 1–3 % sapma xəbərdarlıqdır (`SVG_VIEWBOX_ASPECT`), 3 %-dən çox xətadır (`SVG_VIEWBOX_MISMATCH`). `viewBox`-un bir vahidi bir nöqtəyə bərabərdir.
2. **Mətni konturlara çevirin.** Şriftlər SVG-yə yazılmır. `<text>` elementi `SVG_TEXT_ELEMENTS` xəbərdarlığı verir və başqa şriftlə çap olunar. Bütün başlıq və etiketləri path-a çevirin.
3. **Xarici istinad olmasın.** Sənəddən kənara `href`, `xlink:href`, `url(...)`, həmçinin `@import`, `<script>`, `<foreignObject>`, `<!DOCTYPE>` və `on…` atributları qadağandır. Eyni fayldakı elementə istinad (`#gradient1`) və `data:image/png|jpeg;base64,` şəkillərə icazə var, amma loqonu SVG-yə yox, `images` bölməsinə qoyun.
4. **Yüngül saxlayın.** Ən çoxu 5 MiB, dərinlik 64, 200 000 element. Yolları sadələşdirin, gizli təbəqələri, redaktor metadatasını və işlənməyən təriflər silin.

### Inkscape

1. `File → Document Properties`: **Display units** və **Custom size** vahidini `pt` (və ya miqyas 1,0 ilə `px`) edin, ölçü `841.89 × 595.28`, **Scale x = 1.0**. `Edit → XML Editor`-da kök `<svg>`-də `viewBox="0 0 841.89 595.28"` olduğunu yoxlayın.
2. Bütün mətnləri seçin (`Edit → Select All in All Layers`), sonra `Path → Object to Path` (`Shift+Ctrl+C`). Qrupların içindəki mətni də çevirin.
3. Gizli təbəqələri və köməkçi obyektləri silin. `File → Clean Up Document` işlənməyən təriflər silir.
4. `File → Save As… → Plain SVG` ("Inkscape SVG" yox) ilə saxlayın.
5. Faylı mətn redaktorunda açıb `<text` və `href` axtarın.

### Figma

1. **842 × 595** (üfüqi) və ya **595 × 842** (şaquli) freym yaradın. Figma pikselləri nöqtəyə bərabərdir; 1 % tolerantlıq daxilində kiçik yuvarlaqlaşdırma problem deyil.
2. Hər mətn təbəqəsini seçib `Object → Flatten` (`Ctrl+E`) edin.
3. Freymdə bitmap şəkil qoymayın; loqo `images`-ə gedir.
4. Freymi **SVG** kimi ixrac edin, **Outline text** qoşulu, **Include "id" attribute** və **Include bounding box** söndürülü olsun.
5. Nəticədə `<text`, `<image` və `href` axtarın.

## 4. Loqo və digər şəkillər (`images`)

Bitmap şəkilləri SVG yox, `config.json` yerləşdirir; beləliklə onlar aydın qalır və yükləmədə yoxlanır.

- Formatlar: PNG (şəffaf fon məsləhətdir) və JPEG. Hər biri ən çoxu 2 MiB və hər tərəfi 4000 px; ən çoxu 10 şəkil.
- **Ayırdetmə.** Effektiv ayırdetmə `piksel eni ÷ çap eni (düymlə)`-dir. Təxminən **300 DPI** hədəfləyin: **4 sm** enində çap olunan loqo (113,39 pt) üçün təxminən **470 px** lazımdır (4 sm = 1,575 düym × 300). 150 DPI-dən aşağı (`IMAGE_LOW_RESOLUTION`) bulanıq görünür, 600 DPI-dən yuxarı (`IMAGE_HIGH_RESOLUTION`) yalnız faylı böyüdür.
- Dizayn alətindən tam lazım olan enlə ixrac edin; kiçik bitmapı böyütməyin.
- **Optimallaşdırın**, itkisiz: `oxipng -o 4 --strip safe logo.png`, tək rəngli loqolar üçün `pngquant --quality 80-95 --ext .png --force logo.png`. 20–60 KB tipikdir.
- `config.json`-dakı `width` çap enidir (nöqtə ilə), hündürlük nisbətə uyğun hesablanır. `x`, `y` sol yuxarı küncdür.

```json
"images": [{ "file": "assets/logo.png", "x": 364.25, "y": 48, "width": 113.39 }]
```

## 5. Şriftlər

- Format: `fonts/` içində **TrueType (`.ttf`)**, hər üslub üçün bir fayl, ən çoxu 8 şrift, hər biri ən çoxu 3 MiB. Şrift kolleksiyaları (`.ttc`) və veb şriftlər (`.woff`) qəbul edilmir. Dəyişkən deyil, statik şriftlər işlədin.
- **Qlif əhatəsi.** `ownerName` və ya `subject` üçün işlənən şrift bütün Azərbaycan əlifbasını, rəqəmləri və `.,-'’()/` simvollarını saxlamalıdır. Kritik hərflər: **`ə Ə ı İ ö ü ç ş ğ`**; çatışmayan şrift `FONT_MISSING_GLYPHS` ilə rədd edilir. Əsas kiril hərfləri də yoxlanır (`FONT_NO_CYRILLIC` xəbərdarlıq verir), çünki iştirakçı adları kirillcə yazıla bilər.
- **Lisenziya.** Yalnız PDF-ə yerləşdirməyə **və paketlə birlikdə yaymağa** icazə verən lisenziyalı şriftlər işlədin, məsələn SIL OFL 1.1 və ya Apache 2.0 (Noto, Liberation, Open Sans, Roboto, Source Sans). Kommersiya şriftləri adətən bunu qadağan edir. Lisenziya mətnini `fonts/LICENSE.txt`-də saxlayın.
- Yükləmədən əvvəl yoxlayın: `fc-query --format '%{charset}\n' fonts/Name.ttf` və ya sadəcə yoxlayıcını işlədin (8-ci bölmə).
- `config.json`-da hər şriftə qısa açar verilir (hərf, rəqəm, `_`, `-`, ən çoxu 32 simvol), sahələr bu açara istinad edir:

```json
"fonts": { "title": "fonts/NotoSerif-Bold.ttf", "body": "fonts/NotoSans-Regular.ttf" }
```

## 6. Sahə mövqelərinin ölçülməsi

1. Dizayn alətində mətnin olacağı yerə, qəbul etdiyiniz ən uzun sətir qədər enli düzbucaqlı qoyun. Ad, mövzu, bacarıqlar, tarix və tip üçün ayrı qutu olsun.
2. Onun mövqeyini və enini **nöqtə** ilə oxuyun (alətin vahidini `pt` edin; 842 × 595 Figma freymində piksel nöqtəyə bərabərdir).
3. `x`, `y`, `width` dəyərlərini düzbucaqlıdan götürün. `size` (mətnin nöqtə ölçüsü) və `maxLines` seçin. Qutunun hündürlüyü `maxLines × size × lineHeight`-dır (`lineHeight` susmaya görə 1,2): `size: 36`, `maxLines: 2` üçün 86,4 pt. Qutu səhifədə qalmalı və başqa qutu (QR daxil) ilə 2 pt-dən çox kəsişməməlidir; bilərəkdən kəsişmə lazımdırsa `allowOverlap: true` yazın.
4. **Uzun mətn bölünür və kiçilir.** Mühərrik `size`-dan `minSize`-a qədər 0,5 pt addımla ən böyük ölçünü seçir ki, mətn ən çoxu `maxLines` sətrə sığsın (`minSize` susmaya görə `max(6, floor(size × 0.6))`). Qutudan enli tək söz yalnız `minSize`-da simvol üzrə bölünür. Heç nə sığmasa, buraxılış `TEXT_DOES_NOT_FIT` ilə dayanır. Gözlədiyiniz ən uzun adları yoxlayın (9-cu bölmə).
5. `align` mətni qutunun içində düzləyir; ortalanmış mətn üçün qutunu səhifə mərkəzinə nəzərən simmetrik edin: `x = (səhifə eni − width) / 2`.
6. QR kod üçün yer qoyun: sxemdə ən azı 40 pt, üstəlik hər modul ən azı 0,4 mm çap olunmalıdır. 90–110 pt rahatdır. Çox kiçik QR `QR_TOO_SMALL` xətası verir.

## 7. Konfiqurasiya məlumatı

`config.json` sərtdir: hər səviyyədə naməlum açarlar rədd edilir. Maşın oxuyan forma: [template-config.schema.json](template-config.schema.json). Aşağıdakı cədvəllər serverin işlətdiyi sxemdən yaradılır (`npm run template-authoring:generate -w api`); əllə dəyişməyin.

### Yuxarı səviyyə

<!-- BEGIN GENERATED: config-reference -->

| Açar               | Məcburi | Tip / icazə verilən dəyərlər                                             | Təsvir (ingiliscə)                                            |
| ------------------ | ------- | ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `engine`           | bəli    | `"svg-pdf"`                                                              |                                                               |
| `page`             | bəli    | object                                                                   |                                                               |
| `page.size`        | bəli    | `"A4"`                                                                   |                                                               |
| `page.orientation` | bəli    | `"landscape"` \| `"portrait"`                                            |                                                               |
| `locale`           | xeyr    | `"az"` \| `"en"`                                                         | Date formatting locale, default az.                           |
| `background`       | bəli    | string, pattern `^([A-Za-z0-9._-]+/)*[A-Za-z0-9._-]+\.svg$`, ≤ 100 chars |                                                               |
| `images`           | xeyr    | array, ≤ 10 items                                                        |                                                               |
| `images[].file`    | bəli    | string, pattern `^assets/[A-Za-z0-9._-]+\.(png\|jpe?g)$`, ≤ 100 chars    |                                                               |
| `images[].x`       | bəli    | number, ≥ 0, ≤ 10000                                                     |                                                               |
| `images[].y`       | bəli    | number, ≥ 0, ≤ 10000                                                     |                                                               |
| `images[].width`   | bəli    | number, > 0, ≤ 10000                                                     | Printed width in points; the height follows the aspect ratio. |
| `fonts`            | bəli    | object                                                                   |                                                               |
| `fonts.<name>`     | xeyr    | string, pattern `^fonts/[A-Za-z0-9._-]+\.ttf$`, ≤ 100 chars              |                                                               |
| `fields`           | bəli    | object                                                                   |                                                               |
| `qr`               | bəli    | object                                                                   |                                                               |
| `qr.x`             | bəli    | number, ≥ 0, ≤ 10000                                                     |                                                               |
| `qr.y`             | bəli    | number, ≥ 0, ≤ 10000                                                     |                                                               |
| `qr.size`          | bəli    | number, ≥ 40, ≤ 10000                                                    |                                                               |

<!-- END GENERATED: config-reference -->

### Sahə açarları

`fields.ownerName` məcburidir, qalan sahələr istəyə bağlıdır. Hər sahə obyekti eyni açarları işlədir:

<!-- BEGIN GENERATED: field-keys -->

Sahə adları: `ownerName`, `subject`, `skills`, `issuedAt`, `type`.

| Açar           | Məcburi | Tip / icazə verilən dəyərlər                                                                                                   | Təsvir (ingiliscə)                                                                                                                                                                        |
| -------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `x`            | bəli    | number, ≥ 0, ≤ 10000                                                                                                           | Left edge of the box in points.                                                                                                                                                           |
| `y`            | bəli    | number, ≥ 0, ≤ 10000                                                                                                           | Top edge of the box in points (y grows downwards).                                                                                                                                        |
| `width`        | bəli    | number, > 0, ≤ 10000                                                                                                           | Box width in points; text wraps inside it.                                                                                                                                                |
| `font`         | bəli    | string                                                                                                                         | Key of an entry in `fonts`.                                                                                                                                                               |
| `size`         | bəli    | number, ≥ 6, ≤ 200                                                                                                             | Font size in points.                                                                                                                                                                      |
| `color`        | bəli    | string, pattern `^#[0-9A-Fa-f]{6}$`                                                                                            |                                                                                                                                                                                           |
| `align`        | bəli    | `"left"` \| `"center"` \| `"right"`                                                                                            |                                                                                                                                                                                           |
| `maxLines`     | bəli    | integer, ≥ 1, ≤ 10                                                                                                             |                                                                                                                                                                                           |
| `format`       | xeyr    | `"text"` \| `"uppercase"` \| `"lowercase"` \| `"titlecase"` \| `"date-dmy"` \| `"date-iso"` \| `"date-long"` \| `"list-comma"` | Formatter name. Defaults per field: `text` for ownerName, subject and type; `list-comma` for skills; `date-long` for issuedAt. `list-comma` only fits `skills`, `date-*` only `issuedAt`. |
| `minSize`      | xeyr    | number, ≥ 6                                                                                                                    | Smallest font size the text may shrink to. Default max(6, floor(size * 0.6)) capped at size; must be between 6 and size.                                                                  |
| `lineHeight`   | xeyr    | number, ≥ 1, ≤ 2                                                                                                               | Line height factor, default 1.2.                                                                                                                                                          |
| `allowOverlap` | xeyr    | boolean                                                                                                                        | Allows this box to overlap another box by more than 2 pt (reported as a warning).                                                                                                         |

<!-- END GENERATED: field-keys -->

Beş sahənin nümunəsi (hər açar ən azı bir dəfə göstərilib):

```json
"fields": {
  "ownerName": { "x": 70.9, "y": 270, "width": 700, "font": "title", "size": 38, "color": "#1d3557", "align": "center", "maxLines": 1, "format": "text", "minSize": 22, "lineHeight": 1.2 },
  "subject":   { "x": 160.95, "y": 325, "width": 520, "font": "serif", "size": 20, "color": "#333333", "align": "center", "maxLines": 2, "format": "titlecase", "lineHeight": 1.25 },
  "skills":    { "x": 160.95, "y": 385, "width": 520, "font": "body", "size": 13, "color": "#555555", "align": "center", "maxLines": 2, "format": "list-comma" },
  "type":      { "x": 160.95, "y": 435, "width": 520, "font": "strong", "size": 12, "color": "#b8902f", "align": "center", "maxLines": 1, "format": "uppercase" },
  "issuedAt":  { "x": 70, "y": 512, "width": 230, "font": "body", "size": 13, "color": "#333333", "align": "left", "maxLines": 1, "format": "date-long" }
}
```

Hər sahə nəyi çap edir: `ownerName` iştirakçının adını; `subject` tədbir və ya kursun adını; `skills` bacarıqlar siyahısını (`list-comma` vergüllə ayırır); `issuedAt` Bakı vaxtı ilə verilmə tarixini; `type` sertifikat tipini (`attendance`, `appreciation`, `thanks`, `distinction`, `instructor`, `student`, `team`, `other`). Boş dəyər xətasız keçilir.

### Formatlar

`format` xam dəyəri çap olunan mətnə çevirir. Şablonun `locale`-ı `az` olanda `uppercase`, `lowercase` və `titlecase` Azərbaycan qaydalarına uyğundur (`i → İ`, `I → ı`); `date-long` `locale`-ın ay adlarını işlədir.

<!-- BEGIN GENERATED: formats -->

| Format       | Uyğun sahə               | Susmaya görə             | Nümunə, `az` lokalı              | Nümunə, `en` lokalı              |
| ------------ | ------------------------ | ------------------------ | -------------------------------- | -------------------------------- |
| `text`       | ownerName, subject, type | ownerName, subject, type | aysel məmmədova-əliyeva          | aysel məmmədova-əliyeva          |
| `uppercase`  | ownerName, subject, type |                          | AYSEL MƏMMƏDOVA-ƏLİYEVA          | AYSEL MƏMMƏDOVA-ƏLIYEVA          |
| `lowercase`  | ownerName, subject, type |                          | aysel məmmədova-əliyeva          | aysel məmmədova-əliyeva          |
| `titlecase`  | ownerName, subject, type |                          | Aysel Məmmədova-Əliyeva          | Aysel Məmmədova-Əliyeva          |
| `date-dmy`   | issuedAt                 |                          | 03.11.2026                       | 03.11.2026                       |
| `date-iso`   | issuedAt                 |                          | 2026-11-03                       | 2026-11-03                       |
| `date-long`  | issuedAt                 | issuedAt                 | 3 noyabr 2026                    | 3 November 2026                  |
| `list-comma` | skills                   | skills                   | TypeScript, Cloud Run, Firestore | TypeScript, Cloud Run, Firestore |

<!-- END GENERATED: formats -->

### Səhifə, QR kod və tam nümunələr

```json
"page": { "size": "A4", "orientation": "landscape" },
"qr": { "x": 640, "y": 455, "size": 90 }
```

Tam paketlər: [`docs/templates/reference/config.json`](templates/reference/config.json) (bütün açarlar), [`docs/templates/portrait/config.json`](templates/portrait/config.json) və [`docs/templates/minimal/config.json`](templates/minimal/config.json) (yalnız `ownerName` və `qr`).

## 8. Oflayn yoxlama

Yükləmədə işləyən eyni yoxlamalar əmr kimi mövcuddur. Repozitoriyanın kökündən, `npm ci`-dən sonra:

```bash
npm run template:validate -w api -- ../my-template
npm run template:validate -w api -- ../my-template --json
```

Yol `api/` qovluğuna nəzərən verilir. Çıxış kodu `0` paket qəbul olunub (xəbərdarlıq ola bilər), `1` rədd edilib, `2` yanlış istifadə və ya oxunmayan qovluq deməkdir. Hər tapıntı kodu, config yolunu və ya faylı və mesajı göstərir; 10-cu bölmədəki cədvələ baxın. Əmr yalnız qovluğu oxuyur: şəbəkə yoxdur, symlink qəbul edilmir.

## 9. Yükləmə, önbaxış və versiyalar

1. **Yükləmə.** Admin tətbiqində `Templates → Upload template` açın, təşkilatı, tədbiri və sertifikat tipini seçin, sonra paket qovluğunu (`config.json`, `background.svg`, `fonts/`, `assets/`) seçin və ya atın. Problemlər yükləmədən əvvəl və sonra göstərilir; xəbərdarlıqlar yükləməyə mane olmur.
2. **İstinad və versiya.** Server şablona `<təşkilat-slug>-<tədbir-slug>-<tip>-v<n>` adı verir (məsələn `acme-devfest-attendance-v0`). Təşkilat, tədbir və tip üçün ilk yükləmə `v0`-dır, hər növbəti yükləmə növbəti nömrədir. Nömrəni siz seçmirsiniz, dərc olunmuş versiya heç vaxt dəyişdirilmir.
3. **Yeni versiya.** Dizaynı düzəltmək üçün düzəldilmiş paketi eyni təşkilat, tədbir və tip üçün yeni versiya kimi yükləyin (şablon səhifəsində `New version`, və ya başqa tədbirdə istifadə üçün `Copy to another event`). Artıq verilmiş sertifikatlar verildikləri versiyada qalır.
4. **Önbaxış.** Şablon səhifəsindəki `Preview` nümunə sertifikat çəkir (`POST /api/v1/admin/templates/{reference}/preview`); tipik və ən uzun mətn variantı var (120 simvolluq ad, 200 simvolluq mövzu, hər biri 40 simvolluq 10 bacarıq). Sığmayan mətn PDF əvəzinə sahənin adı ilə bildirilir. Həmişə hər iki variantı və `ə İ ı ş ğ` olan adı yoxlayın.

## 10. Yoxlayıcı kodlarının problemlərinin həlli

Xətalar yükləməni rədd edir, xəbərdarlıqlar etmir. Tapıntıdakı `path` `fields.subject.font` və ya `images[0].file` kimi config yoludur.

| Kod                                                                                                                       | Səviyyə                   | Mənası və düzəliş                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TEMPLATE_INVALID`                                                                                                        | xəta                      | HTTP 422 sarğısı; `details[]` aşağıdakı bütün tapıntıları sadalayır. Hamısını düzəldib yenidən yükləyin.                                                                                                         |
| `TOO_MANY_FILES`                                                                                                          | xəta                      | 30-dan çox fayl. Lazımsız faylları silin.                                                                                                                                                                        |
| `PACKAGE_TOO_LARGE`                                                                                                       | xəta                      | Cəmi 10 MiB-dən çox. Şəkilləri optimallaşdırın, işlənməyən şriftləri silin.                                                                                                                                      |
| `FILE_TOO_LARGE`                                                                                                          | xəta                      | Fayl limitini aşır (fon 5 MiB, şəkil 2 MiB, şrift 3 MiB). Optimallaşdırın.                                                                                                                                       |
| `FILENAME_INVALID`                                                                                                        | xəta                      | Fayl adında icazəsiz simvol var (yalnız hərf, rəqəm, `.`, `_`, `-`, `/`), 100 simvoldan uzundur və ya yol problemi var. Adı dəyişin.                                                                             |
| `FILENAME_CONTROL_CHARACTERS`                                                                                             | xəta                      | Fayl adında idarəedici simvollar var. Adı dəyişin.                                                                                                                                                               |
| `FILENAME_DUPLICATE_CASE`                                                                                                 | xəta                      | İki fayl yalnız böyük/kiçik hərflə fərqlənir. Birinin adını dəyişin.                                                                                                                                             |
| `FILENAME_UNSUPPORTED`                                                                                                    | xəta                      | Yol `background.svg`, `fonts/<ad>.ttf` və ya `assets/<ad>.png                                                                                                                                                    | jpg | jpeg` deyil. Faylı köçürün və ya adını dəyişin. |
| `FILE_NOT_FOUND`                                                                                                          | xəta                      | `config.json` paketdə olmayan fayla istinad edir. Yazılışı və qovluğu (`fonts/`, `assets/`) yoxlayın.                                                                                                            |
| `UNREFERENCED_FILE`                                                                                                       | xəbərdarlıq               | Fayl `config.json`-da işlənmir (lisenziya faylı normaldır). Lazım deyilsə silin.                                                                                                                                 |
| `SVG_NOT_XML`                                                                                                             | xəta                      | `background.svg` düzgün XML deyil. Plain SVG kimi yenidən ixrac edin.                                                                                                                                            |
| `SVG_ROOT_NOT_SVG`                                                                                                        | xəta                      | Kök element `<svg>` deyil.                                                                                                                                                                                       |
| `SVG_TOO_COMPLEX`                                                                                                         | xəta                      | Çox dərin (64), çox element (200 000) və ya atribut (elementə 100). Dizaynı sadələşdirin.                                                                                                                        |
| `SVG_DOCTYPE`                                                                                                             | xəta                      | Faylda `<!DOCTYPE` və ya `<!ENTITY` var. Silin; plain SVG kimi saxlayın.                                                                                                                                         |
| `SVG_PROCESSING_INSTRUCTION`                                                                                              | xəta                      | XML bəyannaməsindən başqa emal göstərişi var (məsələn stil cədvəli). Silin.                                                                                                                                      |
| `SVG_SCRIPT`                                                                                                              | xəta                      | `<script>` qadağandır. Silin.                                                                                                                                                                                    |
| `SVG_FOREIGN_OBJECT`                                                                                                      | xəta                      | `<foreignObject>` qadağandır. Məzmununu fiqurlara çevirin.                                                                                                                                                       |
| `SVG_EVENT_HANDLER`                                                                                                       | xəta                      | `on…` atributu (`onclick`, `onload`…) tapıldı. Silin.                                                                                                                                                            |
| `SVG_EXTERNAL_REFERENCE`                                                                                                  | xəta                      | `href` və ya `url(...)` sənəddən kənara baxır. Fiquru daxil edin və ya şəkli `images`-ə köçürün.                                                                                                                 |
| `SVG_CSS_IMPORT`                                                                                                          | xəta                      | CSS `@import` qadağandır. Stilləri sətir daxilinə yazın.                                                                                                                                                         |
| `SVG_CSS_ESCAPE`                                                                                                          | xəta                      | Stil və ya `url(...)` dəyərində tərs xətt qaçışı var, bu qadağan quruluşu gizlədə bilər. Tərs xətti silin.                                                                                                       |
| `SVG_NO_VIEWBOX`                                                                                                          | xəta                      | Kök `<svg>`-də `viewBox` yoxdur. `viewBox="0 0 841.89 595.28"` əlavə edin.                                                                                                                                       |
| `SVG_VIEWBOX_MISMATCH`                                                                                                    | xəta                      | `viewBox` nisbəti səhifədən 3 %-dən çox fərqlənir. Artboard-u A4 və düzgün istiqamətə gətirin.                                                                                                                   |
| `SVG_VIEWBOX_ASPECT`                                                                                                      | xəbərdarlıq               | Nisbət səhifədən 1–3 % fərqlənir. Dəqiq A4 ölçüsünü seçin.                                                                                                                                                       |
| `SVG_TEXT_ELEMENTS`                                                                                                       | xəbərdarlıq               | SVG-də `<text>` var; başqa şriftlə çap olunar. Mətni konturlara çevirin.                                                                                                                                         |
| `IMAGE_CORRUPT`                                                                                                           | xəta                      | Şəkil düzgün PNG və ya JPEG deyil. Yenidən ixrac edin.                                                                                                                                                           |
| `IMAGE_TYPE_MISMATCH`                                                                                                     | xəta                      | Uzantı məzmunla uyğun gəlmir (`.jpg` adlı PNG). Uzantını düzəldin.                                                                                                                                               |
| `IMAGE_TOO_LARGE_DIMENSIONS`                                                                                              | xəta                      | Şəklin tərəfi 4000 px-dən böyükdür. Kiçildin.                                                                                                                                                                    |
| `IMAGE_LOW_RESOLUTION`                                                                                                    | xəbərdarlıq               | Çap eni `width`-də 150 DPI-dən aşağı. Daha böyük bitmap ixrac edin və ya daha kiçik çap edin.                                                                                                                    |
| `IMAGE_HIGH_RESOLUTION`                                                                                                   | xəbərdarlıq               | 600 DPI-dən yuxarı. Təxminən 300 DPI-yə qədər kiçildin.                                                                                                                                                          |
| `FONT_INVALID`                                                                                                            | xəta                      | Tək TrueType şrift deyil (boş, zədəli və ya kolleksiya). Statik `.ttf` işlədin.                                                                                                                                  |
| `FONT_MISSING_GLYPHS`                                                                                                     | xəta                      | `ownerName` və ya `subject` şriftində Azərbaycan hərfləri, rəqəmlər və ya durğu işarələri yoxdur. Başqa şrift seçin (5-ci bölmə).                                                                                |
| `FONT_NO_CYRILLIC`                                                                                                        | xəbərdarlıq               | Şriftdə əsas kiril hərfləri yoxdur. Kirillcə adlar çap olunmaz.                                                                                                                                                  |
| `FONT_NOT_DEFINED`                                                                                                        | xəta                      | Sahənin `font` dəyəri `fonts` açarı deyil. Yazılışı yoxlayın.                                                                                                                                                    |
| `FORMAT_NOT_APPLICABLE`                                                                                                   | xəta                      | `format` sahəyə uyğun deyil (`list-comma` yalnız `skills`, `date-*` yalnız `issuedAt` üçün).                                                                                                                     |
| `OUT_OF_BOUNDS`                                                                                                           | xəta                      | Sahə qutusu və ya QR kod səhifədən çıxır (sağ kənar və ya, `maxLines × size × lineHeight` hündürlüyü ilə, alt kənar). Köçürün və ya kiçildin.                                                                    |
| `BOXES_OVERLAP`                                                                                                           | xəta / xəbərdarlıq        | İki qutu (QR daxil) 2 pt-dən çox kəsişir. Birini köçürün və ya `allowOverlap: true` yazın, onda xəta xəbərdarlığa çevrilir.                                                                                      |
| `unrecognized_keys`, `invalid_type`, `required`, `invalid_value`, `too_small`, `too_big`, `invalid_format`, `invalid_key` | xəta                      | `config.json` sxem xətaları: naməlum açar, yanlış tip və ya dəyər, çatışmayan məcburi açar, diapazondan kənar dəyər, yanlış naxış (məsələn rəng `#RRGGBB`). `path` açarı göstərir; 7-ci bölmə ilə müqayisə edin. |
| `TEXT_DOES_NOT_FIT`                                                                                                       | xəta (önbaxış, buraxılış) | Mətn `minSize`-da belə `maxLines` sətirdə qutuya sığmır. Qutunu genişləndirin, sətir sayını artırın, `minSize`-ı azaldın və ya mətni qısaldın.                                                                   |
| `QR_TOO_SMALL`                                                                                                            | xəta (önbaxış, buraxılış) | QR modulları 0,4 mm-dən kiçik çap olunar. `qr.size`-ı artırın.                                                                                                                                                   |
| `RENDER_ENGINE_UNSUPPORTED`                                                                                               | xəta                      | `engine` bu serverdə olmayan mühərriki göstərir. `svg-pdf` yazın.                                                                                                                                                |
| `RENDER_TOO_LARGE`                                                                                                        | xəta                      | Yaranan PDF 2 MB-dan böyükdür, adətən optimallaşdırılmamış şəkilə görə. Şəkli optimallaşdırın və ya kiçildin (4-cü bölmə).                                                                                       |

## 11. Limitlər

<!-- BEGIN GENERATED: limits -->

| Limit                                                              | Dəyər              |
| ------------------------------------------------------------------ | ------------------ |
| Paketdəki fayllar                                                  | 30                 |
| Paket ölçüsü                                                       | 10 MiB             |
| `background.svg` ölçüsü                                            | 5 MiB              |
| Şəkil ölçüsü                                                       | 2 MiB              |
| Şəklin tərəfi                                                      | 4000 px            |
| Şrift faylının ölçüsü                                              | 3 MiB              |
| Loqonun effektiv ayırdetməsi (kənarda xəbərdarlıq)                 | 150 – 600 DPI      |
| SVG parser limitləri (dərinlik / element / elementə düşən atribut) | 64 / 200,000 / 100 |

<!-- END GENERATED: limits -->

## 12. Vizual uyğunluq siyahısı

Mövcud dizaynı köçürərkən və ya şablonu təsdiq üçün təhvil verərkən istifadə edin.

- [ ] Səhifə ölçüsü və istiqaməti orijinal çapa uyğundur (A4 üfüqi və ya şaquli).
- [ ] Dizayn bütün mətn konturlara çevrilərək ixrac edilib; faylda `<text`, `<image` və `href` yoxdur (`grep -c '<text\|<image\|href' background.svg` `0` yazır).
- [ ] Hər sahə orijinaldakı yerdədir (çəkilmiş PDF-i orijinalla 100 % miqyasda üst-üstə qoyub müqayisə edin).
- [ ] Şrift, ölçü, rəng və düzləmə orijinala uyğundur; şriftin lisenziyası yaymağa icazə verir.
- [ ] Ən uzun real ad və mövzu sığır (önbaxışda `longest` variantı), qısa ad da yaxşı görünür.
- [ ] `ə İ ı ö ü ç ş ğ` olan ad və kirillcə ad düzgün çap olunur.
- [ ] `format` və `locale` düzgün hərf registri və tarix verir (`3 noyabr 2026`, `03.11.2026`, `2026-11-03`).
- [ ] QR kodun modulu ən azı 0,4 mm-dir, dizaynla örtülmür və çap olunmuş vərəqdən oxunur.
- [ ] Loqo təxminən 300 DPI-dir və optimallaşdırılıb; işlənməyən fayl yoxdur (lisenziya istisna).
- [ ] `npm run template:validate -w api -- <qovluq>` xəta göstərmir.
- [ ] Önbaxış PDF oxuyucuda və kağızda çap edildikdə düzgün görünür.
