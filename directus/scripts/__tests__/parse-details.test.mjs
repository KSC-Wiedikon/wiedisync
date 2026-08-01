import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseHallDetails } from '../hallenfinder/parse-details.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (n) => readFileSync(join(here, 'fixtures', n), 'utf-8')

const einfach = fixture('details-einfachhalle-44.html')       // Sporthalle Aegerten, has a photo
const doppel = fixture('details-doppelhalle-165.html')        // Falletsche, 2 partitions + photo
const gym = fixture('details-gymnastikraum-nophoto-39.html')  // Buhnrain, placeholder image

test('single-court hall: type, dimensions, photo, contact', () => {
  const d = parseHallDetails(einfach)
  assert.equal(d.hallTypeLabel, 'Einfachhalle')
  assert.equal(d.sizeLabel, '23,00 x 10,90 x 5,40 m')
  assert.equal(d.length, 23)
  assert.equal(d.width, 10.9)
  assert.equal(d.height, 5.4)
  assert.deepEqual(d.partitions, [], 'a single-court hall has no partitions')
  assert.equal(d.photoUrl, 'https://www.ssd-sporthallen.stadt-zuerich.ch/assets/media/Bild-Sporthalle-44.jpg')
  assert.equal(d.photoThumbUrl, 'https://www.ssd-sporthallen.stadt-zuerich.ch/assets/media/resizedImages/Bild-Sporthalle-44.jpg')
  assert.equal(d.contactEmail, 'SSD-SAM-einfachsporthallen@zuerich.ch')
})

test('multi-court hall: whole-hall row first, each partition keeps its segment id', () => {
  const d = parseHallDetails(doppel)
  assert.equal(d.hallTypeLabel, 'Doppelhalle')
  // The whole hall, NOT the first partition — getting this backwards would
  // advertise a half-court as if it were the full facility.
  assert.equal(d.length, 44)
  assert.equal(d.width, 22)
  assert.equal(d.height, 9)
  assert.equal(d.partitions.length, 2)
  assert.equal(d.partitions[0].label, 'Halle 1 (1/2)')
  assert.equal(d.partitions[0].length, 14)
  assert.equal(d.partitions[0].segment, '36')
  assert.equal(d.partitions[1].label, 'Halle 2 (1/2)')
  assert.equal(d.partitions[1].length, 30)
  assert.equal(d.partitions[1].segment, '37')
})

test('placeholder image is reported as no photo', () => {
  const d = parseHallDetails(gym)
  assert.equal(d.hallTypeLabel, 'Gymnastikraum')
  assert.equal(d.photoUrl, null, 'empty.jpg is the site placeholder, not a photo')
  assert.equal(d.photoThumbUrl, null)
  // Dimensions are still there — only the picture is missing.
  assert.equal(d.length, 14.5)
  assert.equal(d.width, 6.5)
  assert.equal(d.height, 2.7)
})

test('an unknown measurement (0,00) becomes null, not zero', () => {
  // Several Gymnastikräume print 0,00 for the ceiling height. Storing a real 0
  // would make any "min height" filter drop them as if they were too low.
  const html = einfach.replace('23,00 x 10,90 x 5,40 m', '14,00 x 10,00 x 0,00 m')
  const d = parseHallDetails(html)
  assert.equal(d.length, 14)
  assert.equal(d.width, 10)
  assert.equal(d.height, null)
})

test('a page without a Details section degrades to nulls instead of throwing', () => {
  const d = parseHallDetails('<html><body><h1>Fehler</h1></body></html>')
  assert.equal(d.length, null)
  assert.equal(d.hallTypeLabel, null)
  assert.equal(d.photoUrl, null)
  assert.deepEqual(d.partitions, [])
})
