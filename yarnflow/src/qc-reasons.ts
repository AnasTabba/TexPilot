/**
 * English and Urdu wording for every incoming-QC status, reason, stage state, error and capture
 * instruction. The server sends machine codes; this file is the only place they become sentences.
 *
 * URDU REVIEW STATUS: NOT YET REVIEWED BY A FLUENT TEXTILE-QC READER. The Urdu strings below were
 * drafted by the implementer and are awaiting that review (design §10). `URDU_REVIEWED` stays false
 * until a named reviewer signs them off, and the screen says so while Urdu is selected. Numbers,
 * units, IDs and tolerances are never translated; they are rendered left-to-right in Latin digits.
 */
import type { CaptureRole, DecisionStatus, ErrorCode, Outcome, Reason, StageName, StageState } from './qc-types.ts';

export const URDU_REVIEWED = false;
export type Pair = readonly [english: string, urdu: string];

export const STATUS_TEXT: Record<DecisionStatus, { title: Pair; meaning: Pair }> = {
  ACCEPT: {
    title: ['Sample accepted', 'نمونہ قبول'],
    meaning: ['The inspected sample met the confirmed purchase-order requirements. This is about this sample only, not the roll or the arrival.', 'معائنہ شدہ نمونہ تصدیق شدہ خریداری آرڈر کی شرائط پر پورا اترا۔ یہ صرف اسی نمونے کے بارے میں ہے، رول یا پوری آمد کے بارے میں نہیں۔'],
  },
  HOLD: {
    title: ['Sample on hold', 'نمونہ روک لیا گیا'],
    meaning: ['The inspected sample shows evidence that it does not meet the purchase order. Hold it for a reviewer. Nothing is rejected, paid or dispatched by this result.', 'معائنہ شدہ نمونے میں خریداری آرڈر سے مطابقت نہ ہونے کے شواہد ہیں۔ اسے جائزہ لینے والے کے لیے روک لیں۔ اس نتیجے سے کچھ مسترد، ادا یا روانہ نہیں ہوتا۔'],
  },
  RECAPTURE: {
    title: ['Take the photos again', 'تصاویر دوبارہ لیں'],
    meaning: ['The photos could not be used. Fix what is listed below and capture again. No decision was made about the fabric.', 'تصاویر استعمال نہیں ہو سکیں۔ نیچے دی گئی چیزیں درست کر کے دوبارہ تصویر لیں۔ کپڑے کے بارے میں کوئی فیصلہ نہیں ہوا۔'],
  },
  MANUAL_REVIEW: {
    title: ['Needs manual review', 'دستی جائزہ درکار ہے'],
    meaning: ['The system did not decide. A supervisor must inspect this sample by hand. The reasons are listed below.', 'نظام نے فیصلہ نہیں کیا۔ سپروائزر کو یہ نمونہ خود جانچنا ہوگا۔ وجوہات نیچے درج ہیں۔'],
  },
};

/** What each reason means and, where the operator can fix it, what to do and which photo to retake. */
export const REASON_TEXT: Record<Reason, { text: Pair; fix?: Pair; retake?: CaptureRole[] }> = {
  QUALITY_BLUR: { text: ['A photo is blurred.', 'تصویر دھندلی ہے۔'], fix: ['Rest the phone on a stand or both hands, wait for focus, then retake the close-up.', 'فون کو اسٹینڈ یا دونوں ہاتھوں پر ٹکائیں، فوکس کا انتظار کریں، پھر قریبی تصویر دوبارہ لیں۔'], retake: ['structure'] },
  QUALITY_GLARE: { text: ['A photo has glare or blown-out highlights.', 'تصویر میں چمک یا بہت تیز روشنی ہے۔'], fix: ['Move away from direct light or tilt the lamp so no bright patch falls on the fabric, then retake.', 'براہ راست روشنی سے ہٹیں یا لیمپ کو ایسے موڑیں کہ کپڑے پر چمکدار دھبہ نہ پڑے، پھر دوبارہ لیں۔'], retake: ['structure', 'overview'] },
  QUALITY_MOIRE: { text: ['A photo shows a moiré (wavy interference) pattern.', 'تصویر میں موآرے (لہردار) نمونہ ہے۔'], fix: ['Change the distance slightly and keep the camera square to the fabric, then retake the close-up.', 'فاصلہ تھوڑا بدلیں اور کیمرہ کپڑے کے بالکل سامنے رکھیں، پھر قریبی تصویر دوبارہ لیں۔'], retake: ['structure'] },
  QUALITY_FOLD: { text: ['The fabric is folded or wrinkled in a photo.', 'تصویر میں کپڑا تہہ شدہ یا شکن دار ہے۔'], fix: ['Lay the swatch flat and relaxed on the table with no folds, then retake.', 'نمونے کو میز پر بغیر تہہ کے سیدھا اور ڈھیلا بچھائیں، پھر دوبارہ لیں۔'], retake: ['structure', 'overview'] },
  QUALITY_FRAMING: { text: ['The fabric does not fill the photo as required.', 'کپڑا تصویر میں مطلوبہ حد تک نہیں آیا۔'], fix: ['Fill the frame with fabric and keep the edges of the table out of the picture, then retake.', 'فریم کو کپڑے سے بھریں اور میز کے کنارے تصویر سے باہر رکھیں، پھر دوبارہ لیں۔'], retake: ['overview', 'structure'] },
  SCALE_MISSING: { text: ['The printed scale card was not found.', 'چھپا ہوا پیمانہ کارڈ نہیں ملا۔'], fix: ['Place the scale card flat on the fabric, fully inside the picture, and retake the scale photo.', 'پیمانہ کارڈ کپڑے پر سیدھا اور پورا تصویر کے اندر رکھیں، پھر پیمانے والی تصویر دوبارہ لیں۔'], retake: ['scale'] },
  SCALE_INVALID: { text: ['The scale card could not be read reliably.', 'پیمانہ کارڈ قابل اعتماد طور پر نہیں پڑھا جا سکا۔'], fix: ['Keep the card flat, uncovered and square to the camera, then retake the scale photo.', 'کارڈ کو سیدھا، کھلا اور کیمرے کے بالکل سامنے رکھیں، پھر پیمانے والی تصویر دوبارہ لیں۔'], retake: ['scale'] },
  RESOLUTION_LOW: { text: ['The close-up does not show the threads clearly enough to count.', 'قریبی تصویر میں دھاگے گننے کے لیے کافی واضح نہیں۔'], fix: ['Move closer without digital zoom, keep focus, and retake the close-up.', 'ڈیجیٹل زوم کے بغیر قریب جائیں، فوکس برقرار رکھیں، اور قریبی تصویر دوبارہ لیں۔'], retake: ['structure'] },
  CALIBRATION_EXPIRED: { text: ['The camera calibration for this setup has expired.', 'اس سیٹ اپ کی کیمرہ کیلیبریشن کی میعاد ختم ہو چکی ہے۔'] },
  MEASUREMENT_UNCERTAIN: { text: ['The thread count could not be measured with enough certainty.', 'دھاگوں کی گنتی کافی یقین کے ساتھ نہیں ناپی جا سکی۔'] },
  PATTERN_AMBIGUOUS: { text: ['A printed or woven pattern makes the thread count ambiguous.', 'چھپے یا بُنے ہوئے نمونے کی وجہ سے دھاگوں کی گنتی مبہم ہے۔'] },
  OOD: { text: ['This fabric looks unlike anything the system was validated on.', 'یہ کپڑا ان کپڑوں سے مختلف لگتا ہے جن پر نظام کی جانچ ہوئی تھی۔'] },
  UNKNOWN_FABRIC: { text: ['The fabric type could not be identified.', 'کپڑے کی قسم شناخت نہیں ہو سکی۔'] },
  PO_UNCONFIRMED: { text: ['The purchase-order requirements are not confirmed.', 'خریداری آرڈر کی شرائط کی تصدیق نہیں ہوئی۔'] },
  PO_CONFLICT: { text: ['The purchase-order values contradict each other.', 'خریداری آرڈر کی قدریں ایک دوسرے سے متصادم ہیں۔'] },
  PO_VERSION_STALE: { text: ['The purchase-order requirements changed after this sample was started.', 'یہ نمونہ شروع ہونے کے بعد خریداری آرڈر کی شرائط بدل گئیں۔'] },
  UNIT_UNSUPPORTED: { text: ['The purchase order uses a unit this check does not support.', 'خریداری آرڈر میں ایسی اکائی ہے جو اس جانچ میں شامل نہیں۔'] },
  SPEC_MISSING: { text: ['No confirmed requirements exist for this purchase order.', 'اس خریداری آرڈر کی کوئی تصدیق شدہ شرائط موجود نہیں۔'] },
  STAGE_UNAVAILABLE: { text: ['A required check could not run.', 'ایک ضروری جانچ نہیں چل سکی۔'] },
  DEFECT_SUSPECTED: { text: ['A possible fabric defect was found.', 'کپڑے میں ممکنہ نقص ملا۔'] },
  CONSTRUCTION_OUTSIDE_TOLERANCE: { text: ['The measured thread count is outside the purchase-order limits.', 'ناپی گئی دھاگوں کی گنتی خریداری آرڈر کی حدود سے باہر ہے۔'] },
  FABRIC_MISMATCH: { text: ['The fabric type does not match the purchase order.', 'کپڑے کی قسم خریداری آرڈر سے مطابقت نہیں رکھتی۔'] },
  DOMAIN_UNVALIDATED: { text: ['This kind of fabric and camera setup has not been validated for automatic decisions.', 'اس قسم کے کپڑے اور کیمرہ سیٹ اپ کی خودکار فیصلوں کے لیے توثیق نہیں ہوئی۔'] },
  POLICY_UNRELEASED: { text: ['Automatic decisions are not released. Every sample is reviewed by a person.', 'خودکار فیصلے جاری نہیں کیے گئے۔ ہر نمونے کا جائزہ ایک فرد لیتا ہے۔'] },
  RECAPTURE_LIMIT: { text: ['The photos were retaken three times without success.', 'تصاویر تین بار لینے کے باوجود قابل استعمال نہیں ہوئیں۔'] },
  EVIDENCE_STALE: { text: ['The evidence no longer matches the current requirements or release.', 'شواہد اب موجودہ شرائط یا ریلیز سے مطابقت نہیں رکھتے۔'] },
  AUDIT_UNAVAILABLE: { text: ['The result could not be recorded, so no decision exists.', 'نتیجہ درج نہیں ہو سکا، اس لیے کوئی فیصلہ موجود نہیں۔'] },
};

export const STAGE_TEXT: Record<StageName, Pair> = {
  quality: ['Photo quality', 'تصویر کا معیار'], fabric: ['Fabric type', 'کپڑے کی قسم'], defects: ['Defect check', 'نقص کی جانچ'],
  metrology: ['Thread count', 'دھاگوں کی گنتی'], domain: ['Validated conditions', 'توثیق شدہ حالات'],
};
export const STATE_TEXT: Record<StageState, Pair> = {
  OK: ['Completed', 'مکمل'], ABSTAINED: ['Could not tell', 'نتیجہ نہیں نکل سکا'], FAILED: ['Failed to run', 'چل نہیں سکی'],
  DISABLED: ['Not available', 'دستیاب نہیں'], NOT_RUN: ['Not run', 'نہیں چلائی گئی'],
};
export const ROLE_TEXT: Record<CaptureRole, { name: Pair; instruction: Pair }> = {
  overview: { name: ['Overview photo', 'مجموعی تصویر'], instruction: ['Stand back so the whole sampled area and its position on the roll are visible. Fabric flat, even light.', 'پیچھے ہٹیں تاکہ نمونے کا پورا حصہ اور رول پر اس کی جگہ نظر آئے۔ کپڑا سیدھا، روشنی یکساں۔'] },
  structure: { name: ['Close-up of the weave', 'بُنائی کی قریبی تصویر'], instruction: ['Hold the phone steady and square to the fabric, close enough to see single threads. No digital zoom.', 'فون کو ساکن اور کپڑے کے بالکل سامنے رکھیں، اتنا قریب کہ ایک ایک دھاگا نظر آئے۔ ڈیجیٹل زوم نہیں۔'] },
  scale: { name: ['Photo with the scale card', 'پیمانہ کارڈ والی تصویر'], instruction: ['Lay the printed scale card flat on the fabric, fully inside the picture, and photograph from the same distance as the close-up.', 'چھپا ہوا پیمانہ کارڈ کپڑے پر سیدھا اور پورا تصویر میں رکھیں، اور قریبی تصویر جتنے فاصلے سے تصویر لیں۔'] },
  defect: { name: ['Photo of a suspected defect (optional)', 'مشتبہ نقص کی تصویر (اختیاری)'], instruction: ['If you can see a defect, photograph it close up with even light.', 'اگر کوئی نقص نظر آئے تو یکساں روشنی میں اس کی قریبی تصویر لیں۔'] },
};
export const AXIS_TEXT: Record<string, Pair> = {
  ends: ['Ends (warp threads)', 'تانے کے دھاگے'], picks: ['Picks (weft threads)', 'بانے کے دھاگے'],
  wales: ['Wales (knit columns)', 'ویلز (نِٹ کالم)'], courses: ['Courses (knit rows)', 'کورسز (نِٹ قطاریں)'],
};
export const OUTCOME_TEXT: Record<Outcome, Pair> = {
  CONFORMING: ['Reviewer found it conforming', 'جائزہ کار کے مطابق درست'], NONCONFORMING: ['Reviewer found it nonconforming', 'جائزہ کار کے مطابق غیر مطابق'],
  UNDETERMINED: ['Reviewer could not determine', 'جائزہ کار تعین نہیں کر سکا'],
};
/** Client-side failure kinds join the server codes so every failure has one sentence. */
export type FailureCode = ErrorCode | 'TRANSPORT' | 'STALE_SESSION' | 'ABORTED' | 'BAD_RESPONSE' | 'UNKNOWN_OUTCOME';
export const ERROR_TEXT: Record<FailureCode, Pair> = {
  UNAUTHENTICATED: ['Your session ended. Sign in again; nothing was decided.', 'آپ کا سیشن ختم ہو گیا۔ دوبارہ سائن اِن کریں؛ کوئی فیصلہ نہیں ہوا۔'],
  FORBIDDEN: ['Your role cannot do this.', 'آپ کا کردار یہ کام نہیں کر سکتا۔'],
  NOT_FOUND: ['This record was not found in your workspace.', 'یہ ریکارڈ آپ کے ورک اسپیس میں نہیں ملا۔'],
  MALFORMED_REQUEST: ['The request could not be read. Refresh and try again.', 'درخواست پڑھی نہیں جا سکی۔ ریفریش کر کے دوبارہ کوشش کریں۔'],
  METHOD_NOT_ALLOWED: ['This action is not available.', 'یہ عمل دستیاب نہیں۔'],
  CONFLICT: ['Something changed while you were working. Reload the sample to see the current state.', 'آپ کے کام کے دوران کچھ بدل گیا۔ موجودہ حالت دیکھنے کے لیے نمونہ دوبارہ لوڈ کریں۔'],
  PAYLOAD_TOO_LARGE: ['The photo is too large. Each photo may be at most 12 MB and 16 megapixels.', 'تصویر بہت بڑی ہے۔ ہر تصویر زیادہ سے زیادہ 12 MB اور 16 میگا پکسل ہو سکتی ہے۔'],
  UNSUPPORTED_MEDIA: ['This file type is not supported. Use a JPEG, PNG or WebP photo.', 'یہ فائل کی قسم قابل قبول نہیں۔ JPEG، PNG یا WebP تصویر استعمال کریں۔'],
  VALIDATION_FAILED: ['Some values were not accepted. Check them and try again.', 'کچھ قدریں قبول نہیں ہوئیں۔ انہیں جانچ کر دوبارہ کوشش کریں۔'],
  CAPACITY_LIMIT: ['The scanner is busy with another sample. Try again shortly.', 'اسکینر کسی اور نمونے میں مصروف ہے۔ تھوڑی دیر بعد دوبارہ کوشش کریں۔'],
  SERVICE_UNAVAILABLE: ['The scanner or the record store is not available. Nothing was decided. Inspect by hand or try again later.', 'اسکینر یا ریکارڈ اسٹور دستیاب نہیں۔ کوئی فیصلہ نہیں ہوا۔ ہاتھ سے معائنہ کریں یا بعد میں کوشش کریں۔'],
  DEADLINE_EXCEEDED: ['The analysis took too long and was stopped. Nothing was decided.', 'تجزیہ بہت دیر لگنے پر روک دیا گیا۔ کوئی فیصلہ نہیں ہوا۔'],
  INTERNAL_ERROR: ['The server could not complete this. Nothing was confirmed.', 'سرور یہ مکمل نہیں کر سکا۔ کسی چیز کی تصدیق نہیں ہوئی۔'],
  TRANSPORT: ['No connection to the server. Your photos are still here; nothing was decided.', 'سرور سے رابطہ نہیں۔ آپ کی تصاویر یہیں موجود ہیں؛ کوئی فیصلہ نہیں ہوا۔'],
  STALE_SESSION: ['The signed-in person changed. Earlier work on this device was cleared.', 'سائن اِن فرد بدل گیا۔ اس ڈیوائس پر پہلے کا کام صاف کر دیا گیا۔'],
  ABORTED: ['Cancelled.', 'منسوخ۔'],
  BAD_RESPONSE: ['The server answered in a form this app does not understand, so nothing is shown as decided. Refresh the app.', 'سرور کا جواب ایپ کی سمجھ سے باہر ہے، اس لیے کچھ بھی طے شدہ نہیں دکھایا گیا۔ ایپ ریفریش کریں۔'],
  UNKNOWN_OUTCOME: ['The connection dropped before the server answered, so it is not known whether this was saved. Reload the sample and check before doing it again.', 'سرور کے جواب سے پہلے رابطہ ٹوٹ گیا، اس لیے معلوم نہیں کہ یہ محفوظ ہوا یا نہیں۔ دوبارہ کرنے سے پہلے نمونہ دوبارہ لوڈ کر کے جانچ لیں۔'],
};
export const DRAFT_TEXT: Record<string, Pair> = {
  TOO_MANY: ['A capture set holds at most 4 photos.', 'ایک کیپچر سیٹ میں زیادہ سے زیادہ 4 تصاویر ہو سکتی ہیں۔'],
  TOO_LARGE: ['This photo is larger than 12 MB.', 'یہ تصویر 12 MB سے بڑی ہے۔'],
  SET_TOO_LARGE: ['Together the photos are larger than 48 MB.', 'تمام تصاویر مل کر 48 MB سے بڑی ہیں۔'],
  TOO_MANY_PIXELS: ['This photo has more than 16 megapixels. Lower the camera resolution and retake.', 'اس تصویر میں 16 میگا پکسل سے زیادہ ہیں۔ کیمرے کی ریزولوشن کم کر کے دوبارہ لیں۔'],
  UNSUPPORTED_MEDIA: ['This is not a JPEG, PNG or WebP photo.', 'یہ JPEG، PNG یا WebP تصویر نہیں ہے۔'],
  HEIC: ['This is a HEIC photo, which is not supported. On iPhone: Settings → Camera → Formats → Most Compatible, then take the photo again. A converted copy would not count as an original.', 'یہ HEIC تصویر ہے جو قابل قبول نہیں۔ آئی فون پر: Settings → Camera → Formats → Most Compatible، پھر تصویر دوبارہ لیں۔ تبدیل شدہ نقل اصل شمار نہیں ہوگی۔'],
  UNREADABLE: ['This file could not be read as a photo.', 'یہ فائل تصویر کے طور پر نہیں پڑھی جا سکی۔'],
  EXPIRED: ['These photos are more than 24 hours old and were cleared. Capture again.', 'یہ تصاویر 24 گھنٹے سے پرانی تھیں اور صاف کر دی گئیں۔ دوبارہ تصویر لیں۔'],
  PREVIEW_TOO_LARGE: ['The preview could not be made small enough; the original is still kept.', 'پیش نظارہ کافی چھوٹا نہیں بن سکا؛ اصل تصویر محفوظ ہے۔'],
};
export const CAMERA_TEXT: Record<'denied' | 'unsupported' | 'unavailable', Pair> = {
  denied: ['Camera access is blocked for this site. Allow the camera in the browser settings for this page, or choose a photo file instead.', 'اس سائٹ کے لیے کیمرے کی رسائی بند ہے۔ براؤزر کی ترتیبات میں اس صفحے کے لیے کیمرہ کھولیں، یا اس کی جگہ تصویر کی فائل چنیں۔'],
  unsupported: ['This browser cannot take a full-resolution photo from the page. Use “Choose original” to pick a photo from this phone instead.', 'یہ براؤزر صفحے سے مکمل ریزولوشن تصویر نہیں لے سکتا۔ اس فون سے تصویر چننے کے لیے “اصل تصویر چنیں” استعمال کریں۔'],
  unavailable: ['No camera was found on this device. Choose a photo file instead.', 'اس ڈیوائس پر کوئی کیمرہ نہیں ملا۔ اس کی جگہ تصویر کی فائل چنیں۔'],
};
export const pick = (pair: Pair, language: 'en' | 'ur') => pair[language === 'ur' ? 1 : 0];
