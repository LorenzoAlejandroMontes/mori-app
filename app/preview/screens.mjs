// The walk through every main screen of the preview bench, shared by shoot.mjs
// (screenshots) and audit.mjs (accessibility). Each `yield` is one screen,
// rendered and settled: the caller looks at the page, then the walk goes on.
export async function* screens(p, base) {
  const settle = () => p.waitForTimeout(450);
  await p.goto(`${base}/?v=app`);
  await p.waitForSelector(".home-head h1");
  await p.evaluate(() => document.fonts.ready);
  await settle();
  yield "01-oggi";
  await nav(p, "chat");
  await settle();
  yield "02-chat";
  await p.click("text=Sync settimanale prodotto >> nth=0");
  await settle();
  yield "03-call";
  await p.click('[role="tab"]:has-text("Trascritto"), [role="tab"]:has-text("Transcript"), .tab:has-text("Trascritto")');
  await settle();
  yield "04-trascritto";
  if (await p.locator(".call-bar").count()) {
    await p.keyboard.press("Control+j");
    await settle();
    yield "04b-call-con-chat";
    await p.keyboard.press("Escape");
  }
  await nav(p, "history");
  await settle();
  yield "05-storico";
  await nav(p, "todos");
  await settle();
  yield "06-da-fare";
  await nav(p, "person");
  await settle();
  yield "07-persone";
  await p.click('[data-nav="settings"], button.gear[title="Impostazioni provider"]');
  await settle();
  yield "08-impostazioni";
  await p.goto(`${base}/?v=app`);
  await p.waitForSelector(".home-head h1");
  await p.keyboard.press("Control+k");
  await p.fill(".cmd-input", "onboarding");
  await settle();
  yield "09-cmdk";
  await p.goto(`${base}/?v=app&fresh=1`);
  await p.waitForSelector(".home-head h1");
  await settle();
  yield "10-prima-apertura";
  await p.goto(`${base}/?v=app&silence=1`);
  await p.waitForSelector(".home-head h1");
  await p.click('[data-rec="idle"] button, .record-btn');
  await p.waitForTimeout(1300);
  yield "12-registrazione";
  await p.goto(`${base}/?v=pill&pill=status`);
  await settle();
  yield "11-pillola";
}

/** Click a section in the sidebar by its id: works in every language. */
async function nav(p, id) {
  await p.click(`.sidebar [data-nav="${id}"], .mini-rail [data-nav="${id}"] >> nth=0`);
}
