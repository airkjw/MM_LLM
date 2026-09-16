import assert from "node:assert/strict";
import test from "node:test";
import { detectMedia, isPublicIpAddress } from "../src/shared/media-security.ts";

test("media validation accepts known binary signatures and rejects active markup", () => {
  assert.equal(detectMedia(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])).mime, "image/png");
  assert.equal(detectMedia(Buffer.from("FORM0000AIFF0000", "ascii")).mime, "audio/aiff");
  assert.equal(detectMedia(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>")), null);
  assert.equal(detectMedia(Buffer.from("<!doctype html><html></html>")), null);
  assert.equal(detectMedia(Buffer.from("not media")), null);
});

test("remote media IP policy allows public addresses and blocks special-use ranges", () => {
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
    assert.equal(isPublicIpAddress(address), true, address);
  }
  for (const address of [
    "0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.31.1.1",
    "192.0.0.1", "192.0.2.1", "192.168.1.1", "198.18.0.1", "198.51.100.1", "203.0.113.1",
    "224.0.0.1", "255.255.255.255", "::", "::1", "fc00::1", "fd00::1", "fe80::1", "ff02::1",
    "2001:db8::1", "2001::1", "2002:7f00:1::", "::ffff:127.0.0.1", "::ffff:169.254.169.254"
  ]) assert.equal(isPublicIpAddress(address), false, address);
});
