/**
 * Floor wording: every phrase a worker reads while recording stock, in English and Urdu side by side.
 * Change words here, not in the screens, so someone who knows how the floor talks can review them in one place.
 * `{name}` placeholders are filled by `say()`.
 */
import { useLanguage } from './i18n';

export const floor = {
  // Daily work on Home
  dailyWork: ['Daily work', 'روز کا کام'],
  receive: ['Receive yarn', 'مال وصول کریں'],
  receiveHint: ['A delivery arrived', 'گاڑی سے مال آیا'],
  issue: ['Issue to production', 'پروڈکشن کو دیں'],
  issueHint: ['Yarn goes to the floor', 'دھاگا فلور پر جائے'],
  returnFloor: ['Return from floor', 'فلور سے واپسی'],
  returnHint: ['Unused yarn comes back', 'بچا ہوا دھاگا واپس آئے'],
  finish: ['Mark ready', 'تیار مال درج کریں'],
  finishHint: ['Production is finished', 'پروڈکشن مکمل ہو گئی'],
  waste: ['Record wastage', 'ضائع شدہ مال'],
  wasteHint: ['Damaged or lost yarn', 'خراب یا گم شدہ دھاگا'],
  dispatch: ['Dispatch', 'مال روانہ کریں'],
  dispatchHint: ['Goods leave the factory', 'مال فیکٹری سے جائے'],
  qc: ['Check quality', 'کوالٹی چیک کریں'],
  qcHint: ['Pass or hold a batch', 'بیچ پاس کریں یا روکیں'],
  correct: ['Correct a mistake', 'غلطی درست کریں'],
  correctHint: ['Undo a wrong entry', 'غلط اندراج واپس کریں'],
  checkStock: ['Check stock', 'اسٹاک دیکھیں'],
  checkStockHint: ['How much do we have?', 'کتنا مال موجود ہے؟'],

  // Choosing a batch
  pickBatch: ['Which batch?', 'کون سا بیچ؟'],
  pickBatchHint: ['Tap the batch written on the bags.', 'بوریوں پر لکھا ہوا بیچ دبائیں۔'],
  findBatch: ['Find by name or batch number', 'نام یا بیچ نمبر سے تلاش کریں'],
  newBatch: ['New delivery: make a new batch', 'نئی ڈیلیوری: نیا بیچ بنائیں'],
  noBatchFound: ['No batch matches. Check the number on the bags.', 'کوئی بیچ نہیں ملا۔ بوری پر لکھا نمبر دیکھیں۔'],
  needsQc: ['Pass QC first', 'پہلے کوالٹی پاس کریں'],
  onHold: ['On hold: cannot move', 'روکا ہوا: منتقل نہیں ہو سکتا'],
  nothingHere: ['No stock here', 'یہاں مال نہیں'],
  back: ['Back', 'واپس'],

  // Stages, in floor words
  stage_raw: ['Raw store', 'خام مال گودام'],
  stage_wip: ['Production floor', 'پروڈکشن فلور'],
  stage_finished: ['Ready goods', 'تیار مال'],
  stage_cops: ['Cops', 'کاپس'],
  from: ['Take from', 'کہاں سے'],
  to: ['Put into', 'کہاں'],
  changeStage: ['Different place?', 'کوئی اور جگہ؟'],
  move: ['Move between places', 'جگہ تبدیل کریں'],
  moveHint: ['Any move between store, floor and ready goods', 'گودام، فلور اور تیار مال کے درمیان'],
  pickFrom: ['Tap where the yarn is taken from.', 'دبائیں کہ دھاگا کہاں سے لیا جا رہا ہے۔'],
  pickTo: ['Tap where the yarn goes.', 'دبائیں کہ دھاگا کہاں جا رہا ہے۔'],

  // Quantities
  howMuch: ['How much?', 'کتنا مال؟'],
  cartons: ['Cartons', 'کارٹن'],
  cones: ['Cones', 'کون'],
  kg: ['Weight on the scale (kg)', 'کانٹے پر وزن (کلو)'],
  zeroIfNone: ['Type 0 if none', 'نہ ہوں تو 0 لکھیں'],
  inPlace: ['In {place} now: {kg} kg · {cartons} cartons · {cones} cones', '{place} میں ابھی: {kg} کلو · {cartons} کارٹن · {cones} کون'],
  note: ['Note (optional)', 'نوٹ (اختیاری)'],
  noteDispatch: ['Customer or gate pass number (optional)', 'گاہک یا گیٹ پاس نمبر (اختیاری)'],

  // Checks under the boxes
  typeCount: ['Type how many {unit}. Type 0 if none.', 'کتنے {unit} ہیں لکھیں۔ نہ ہوں تو 0 لکھیں۔'],
  wholeNumber: ['Use whole numbers only, like 40.', 'صرف پورے عدد لکھیں، جیسے 40۔'],
  typeKg: ['Type the weight from the scale, like 1814.5', 'کانٹے کا وزن لکھیں، جیسے 1814.5'],
  kgPositive: ['Weight must be more than 0 kg.', 'وزن 0 کلو سے زیادہ ہونا چاہیے۔'],
  kgDecimals: ['Use at most 3 digits after the point.', 'اعشاریہ کے بعد زیادہ سے زیادہ 3 ہندسے۔'],
  tooMuch: ['Only {have} {unit} in {place}. You typed {typed}.', '{place} میں صرف {have} {unit} ہیں۔ آپ نے {typed} لکھا۔'],
  oddWeight: ['{cartons} cartons but {kg} kg — that is {each} kg per carton. Check the weight.', '{cartons} کارٹن اور {kg} کلو — یعنی {each} کلو فی کارٹن۔ وزن دوبارہ دیکھیں۔'],
  zeroCounts: ['Cartons and cones are both 0. Is that right?', 'کارٹن اور کون دونوں 0 ہیں۔ کیا یہ درست ہے؟'],
  fixAbove: ['Fix the red boxes above.', 'اوپر سرخ خانے درست کریں۔'],

  // Confirm and saved
  checkThis: ['Check before saving', 'محفوظ کرنے سے پہلے دیکھ لیں'],
  checkThisHint: ['Is this what happened? Stock changes only when you tap Save.', 'کیا یہی ہوا ہے؟ اسٹاک صرف "محفوظ کریں" دبانے پر بدلے گا۔'],
  next: ['Next', 'آگے'],
  save: ['Save', 'محفوظ کریں'],
  change: ['Change', 'تبدیل کریں'],
  cancel: ['Cancel', 'منسوخ'],
  saving: ['Saving…', 'محفوظ ہو رہا ہے…'],
  saved: ['Saved', 'محفوظ ہو گیا'],
  savedHint: ['Everyone on the team sees it now.', 'اب پوری ٹیم اسے دیکھ سکتی ہے۔'],
  undo: ['Undo', 'واپس کریں'],
  another: ['Record another', 'ایک اور درج کریں'],
  home: ['Home', 'ہوم'],

  // Entry sentences: what will be written in the register
  s_receive: ['{qty} of {yarn}, batch {batch}, received into {to}.', '{yarn} (بیچ {batch}) کا {qty} {to} میں وصول ہوا۔'],
  s_transfer: ['{qty} of {yarn}, batch {batch}, moved from {from} to {to}.', '{yarn} (بیچ {batch}) کا {qty} {from} سے {to} منتقل ہوا۔'],
  s_waste: ['{qty} of {yarn}, batch {batch}, written off as wastage from {from}.', '{yarn} (بیچ {batch}) کا {qty} {from} سے ضائع شدہ درج ہوا۔'],
  s_dispatch: ['{qty} of {yarn}, batch {batch}, dispatched from {from}.', '{yarn} (بیچ {batch}) کا {qty} {from} سے روانہ ہوا۔'],
  qty: ['{cartons} cartons · {cones} cones · {kg} kg', '{cartons} کارٹن · {cones} کون · {kg} کلو'],

  // Unfinished entries
  draftBack: ['You started this at {time} and did not save it.', 'آپ نے یہ {time} پر شروع کیا تھا مگر محفوظ نہیں کیا۔'],
  draftKeep: ['Continue it', 'جاری رکھیں'],
  draftFresh: ['Start again', 'نئے سرے سے'],

  // Save status in the footer
  statusOk: ['Up to date with the team · {time}', 'ٹیم کے ساتھ تازہ ترین · {time}'],
  statusOffline: ['No internet. New entries cannot be saved until it is back.', 'انٹرنیٹ نہیں ہے۔ واپس آنے تک نیا اندراج محفوظ نہیں ہوگا۔'],
  statusError: ['Cannot reach Yarnflow · last checked {time}', 'Yarnflow سے رابطہ نہیں · آخری بار {time}'],
  statusChecking: ['Checking…', 'چیک ہو رہا ہے…'],

  // Corrections
  whyCorrect: ['Why is it wrong?', 'غلطی کیا ہے؟'],
  r_weight: ['Wrong weight', 'غلط وزن'],
  r_count: ['Wrong count', 'غلط تعداد'],
  r_batch: ['Wrong batch', 'غلط بیچ'],
  r_twice: ['Entered twice', 'دو بار درج ہوا'],
  r_other: ['Something else', 'کچھ اور'],
  correctionNote: ['Say what happened (optional for the buttons above)', 'کیا ہوا لکھیں (اوپر والے بٹن کے ساتھ اختیاری)'],

  // QC
  qcPass: ['Pass', 'پاس'],
  qcPassHint: ['Checked and good. It can go to production and dispatch.', 'چیک ہو گیا، ٹھیک ہے۔ پروڈکشن اور روانگی ہو سکتی ہے۔'],
  qcHold: ['Hold', 'روکیں'],
  qcHoldHint: ['Problem found. Nothing moves until it is checked again.', 'مسئلہ ہے۔ دوبارہ چیک ہونے تک مال نہیں ہلے گا۔'],
  qcAgain: ['Check again', 'دوبارہ چیک کریں'],
  qcAgainHint: ['Not decided yet. Someone must inspect it again.', 'ابھی فیصلہ نہیں۔ دوبارہ معائنہ ضروری ہے۔'],
  qcReason: ['What did you check?', 'آپ نے کیا چیک کیا؟'],
  q_count: ['Count is right', 'کاؤنٹ درست ہے'],
  q_label: ['Label matches', 'لیبل درست ہے'],
  q_shade: ['Shade problem', 'رنگ میں فرق'],
  q_damage: ['Bags damaged', 'بوریاں خراب'],
  q_wet: ['Wet or dirty', 'گیلا یا گندا'],
} as const satisfies Record<string, readonly [string, string]>;

export type FloorKey = keyof typeof floor;

/** Fill `{name}` placeholders. In Urdu each value is direction-isolated so "1,814 kg" or a batch id never flips. */
export function fill(text: string, vars: Record<string, string | number> = {}, rtl = false) {
  return text.replace(/\{(\w+)\}/g, (_, name) => name in vars ? (rtl ? `\u2068${vars[name]}\u2069` : String(vars[name])) : `{${name}}`);
}

/**
 * The server answers in English. Known answers are reworded here for the floor, in both languages; anything
 * unknown passes through unchanged. Keys are the exact server text (or its start, for messages with numbers).
 */
export const serverWords: [string, string, string][] = [
  ['Stock changed, the quantities exceed available stock', 'There is not that much stock here any more. Someone may have moved it. Check the numbers and try again.', 'یہاں اتنا مال اب موجود نہیں۔ شاید کسی نے منتقل کر دیا۔ تعداد دیکھ کر دوبارہ کوشش کریں۔'],
  ['QC approval is required before issuing raw stock', 'This batch has not passed QC yet, or it is on hold. It cannot move until QC passes it.', 'اس بیچ کی کوالٹی ابھی پاس نہیں یا یہ روکا ہوا ہے۔ کوالٹی پاس ہونے تک مال نہیں ہلے گا۔'],
  ['This lot needs QC approval before dispatch', 'This batch has not passed QC yet, or it is on hold. It cannot be dispatched.', 'اس بیچ کی کوالٹی ابھی پاس نہیں یا یہ روکا ہوا ہے۔ روانہ نہیں ہو سکتا۔'],
  ['This request ID was already used for different values', 'This entry was already saved a moment ago. Open History to check it before entering it again.', 'یہ اندراج ابھی محفوظ ہو چکا ہے۔ دوبارہ درج کرنے سے پہلے ہسٹری میں دیکھیں۔'],
  ['Could not confirm a save', 'No answer from Yarnflow, so we cannot tell if it was saved. Check the internet, then tap Save again. It will not be saved twice.', 'Yarnflow سے جواب نہیں ملا، معلوم نہیں محفوظ ہوا یا نہیں۔ انٹرنیٹ دیکھیں، پھر دوبارہ "محفوظ کریں" دبائیں۔ دو بار محفوظ نہیں ہوگا۔'],
  ['Could not reach Yarnflow', 'Cannot reach Yarnflow. Check the internet. Nothing you saved is lost.', 'Yarnflow سے رابطہ نہیں ہو رہا۔ انٹرنیٹ دیکھیں۔ آپ کا محفوظ کیا ہوا کچھ ضائع نہیں ہوا۔'],
  ['A reversal cannot be reversed', 'This is already a correction. It cannot be undone again.', 'یہ پہلے ہی تصحیح ہے، اسے دوبارہ واپس نہیں کیا جا سکتا۔'],
  ['Reverse this purchase receipt from Incoming stock', 'This came from a purchase order. Correct it in Procurement → Incoming stock.', 'یہ خریداری آرڈر سے آیا ہے۔ اسے خریداری ← آنے والا اسٹاک میں درست کریں۔'],
  ['This material already has that batch number', 'This yarn already has a batch with that number. Pick it from the list instead.', 'اس دھاگے کا اس نمبر سے بیچ پہلے سے موجود ہے۔ اسے فہرست سے منتخب کریں۔'],
  ['That SKU or barcode already exists', 'Another material already uses this code or barcode.', 'یہ کوڈ یا بارکوڈ پہلے سے کسی اور مٹیریل کا ہے۔'],
  ['Receipt exceeds the order quantity', 'This is more than the order still has to come, or the batch number is already used. Check the numbers.', 'یہ آرڈر کی باقی مقدار سے زیادہ ہے یا بیچ نمبر پہلے سے استعمال ہو چکا ہے۔ تعداد دیکھیں۔'],
  ['This receipt was already reversed or its stock has been used', 'This delivery was already corrected, or its yarn is already used.', 'یہ وصولی پہلے ہی درست ہو چکی ہے، یا اس کا دھاگا استعمال ہو چکا ہے۔'],
  ['Sign in with your name and PIN', 'Please sign in again with your name and PIN.', 'براہِ کرم اپنے نام اور پن سے دوبارہ سائن اِن کریں۔'],
  ['That name and PIN do not match', 'Wrong PIN. Try again.', 'پن غلط ہے۔ دوبارہ کوشش کریں۔'],
  ['Too many wrong PINs', 'Too many wrong PINs. Wait a few minutes or ask an admin.', 'بہت زیادہ غلط پن۔ چند منٹ انتظار کریں یا ایڈمن سے کہیں۔'],
  ['The server could not complete this request', 'Something went wrong on the server. Nothing was saved. Try again.', 'سرور پر مسئلہ ہوا۔ کچھ محفوظ نہیں ہوا۔ دوبارہ کوشش کریں۔'],
  ['The request was not saved', 'It was not saved. Try again.', 'محفوظ نہیں ہوا۔ دوبارہ کوشش کریں۔'],
  ['Only an admin can do this', 'Only an admin can do this.', 'یہ صرف ایڈمن کر سکتا ہے۔'],
];

/** The floor wording for a server or client message, in the chosen language. */
export function plainError(message: string, language: 'en' | 'ur') {
  const known = serverWords.find(([start]) => message.startsWith(start));
  return known ? known[language === 'ur' ? 2 : 1] : null;
}

/** say('receive') → the phrase in the current language; say('tooMuch', { have: 40 }) fills placeholders. */
export function useFloor() {
  const { language } = useLanguage();
  return (key: FloorKey, vars?: Record<string, string | number>) => fill(floor[key][language === 'ur' ? 1 : 0], vars, language === 'ur');
}
