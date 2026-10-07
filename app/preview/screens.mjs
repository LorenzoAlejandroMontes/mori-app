// The walk through every main screen of the preview bench, shared by shoot.mjs
// (screenshots) and audit.mjs (accessibility). Each `yield` is one screen,
// rendered and settled: the caller looks at the page, then the walk goes on.
export async function* screens(p, base) {
  const settle = () => p.waitForTimeout(450);
  await p.goto(`${base}/?v=app`);
  await p.waitForSelector(".home-head h1");
  await p.evaluate(() => document.fonts.ready);
  await settle();
  yield "01-today";
  await nav(p, "chat");
  await settle();
  yield "02-chat";
  await p.click("text=Weekly product sync >> nth=0");
  await settle();
  yield "03-call";
  await p.click('[role="tab"]:has-text("Transcript"), .tab:has-text("Transcript")');
  await settle();
  yield "04-transcript";
  if (await p.locator(".call-bar").count()) {
    await p.keyboard.press("Control+j");
    await settle();
    yield "04b-call-with-chat";
    await p.keyboard.press("Escape");
  }
  await nav(p, "history");
  await settle();
  yield "05-history";
  await nav(p, "todos");
  await settle();
  yield "06-todos";
  await nav(p, "person");
  await settle();
  yield "07-people";
  await p.click('[data-nav="settings"]');
  await settle();
  yield "08-settings";
  await p.goto(`${base}/?v=app`);
  await p.waitForSelector(".home-head h1");
  await p.keyboard.press("Control+k");
  await p.fill(".cmd-input", "onboarding");
  await settle();
  yield "09-cmdk";
  await p.goto(`${base}/?v=app&fresh=1`);
  await p.waitForSelector(".home-head h1");
  await settle();
  yield "10-first-run";
  await p.goto(`${base}/?v=app&silence=1`);
  await p.waitForSelector(".home-head h1");
  await p.click('[data-rec="idle"] button, .record-btn');
  await p.waitForTimeout(1300);
  yield "12-recording";
  await p.goto(`${base}/?v=pill&pill=status`);
  await settle();
  yield "11-pill";
}

/** Click a section in the sidebar by its id: works in every language. */
async function nav(p, id) {
  await p.click(`.sidebar [data-nav="${id}"], .mini-rail [data-nav="${id}"] >> nth=0`);
}
