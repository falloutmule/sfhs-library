export async function discoverOptions(page){
 const find=page.locator('#discover-find');if(await find.count()&&await find.getAttribute('open')===null)await find.locator('summary').first().click();
 const options=page.locator('#discover-options');if(await options.count()&&await options.getAttribute('open')===null)await options.locator('summary').first().click();
}
export async function selectDiscoverSource(page,source){
 const web=page.locator('#discover-modes [data-mode="web"]');if(await web.count()&&await web.getAttribute('aria-pressed')!=='true')await web.click();
 await discoverOptions(page);await page.locator('#discover-source').selectOption(source);if(await page.locator('#discover-options>summary').isVisible())await page.locator('#discover-options>summary').click();
}
export async function setDiscoverOpen(page,enabled){await discoverOptions(page);await page.locator('#discover-open').setChecked(enabled);if(await page.locator('#discover-options>summary').isVisible())await page.locator('#discover-options>summary').click();}
