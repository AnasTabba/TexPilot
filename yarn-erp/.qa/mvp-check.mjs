import { chromium } from '@playwright/test';
const browser=await chromium.launch({headless:true});
for(const [name,width,height] of [['desktop',1440,900],['mobile',390,844]]){
 const context=await browser.newContext({viewport:{width,height}});const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:8788/',{waitUntil:'networkidle'});
 await page.screenshot({path:`.qa/mvp-login-${name}.png`,fullPage:true});
 await page.getByLabel('Create a 4-digit PIN').fill('4826');await page.getByLabel('Confirm PIN').fill('4826');await page.getByRole('button',{name:'Save PIN and open workspace'}).click();
 await page.locator('.ref-dashboard').waitFor();
 const visible=await page.locator('body').innerText();if(/\bsample\b|\bMVP\b|DEMO-/i.test(visible))throw Error('Old labels visible on '+name);
 await page.screenshot({path:`.qa/mvp-dashboard-${name}.png`,fullPage:true});
 console.log(name,'metrics',await page.locator('.ref-metric strong').allTextContents(),'overflow',await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),'errors',errors);
 await page.reload();await page.locator('.ref-dashboard').waitFor();
 await context.close();
}
await browser.close();
