import { chromium } from '@playwright/test';
const browser = await chromium.launch({headless:true});
for (const [name,width,height] of [['desktop',1440,900],['mobile',390,844]]) {
  const page = await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:8788/',{waitUntil:'networkidle'});
  await page.getByRole('button',{name:'Open local workspace'}).click();
  await page.locator('.ref-dashboard').waitFor({timeout:10000});
  await page.screenshot({path:`.qa/reference-${name}.png`,fullPage:true});
  console.log(name, 'title=',await page.title(),'heading=',await page.locator('h1').allTextContents(),'dashboard=',await page.locator('.ref-dashboard').count(),'overflow=',await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),'errors=',errors);
  await page.close();
}
await browser.close();
