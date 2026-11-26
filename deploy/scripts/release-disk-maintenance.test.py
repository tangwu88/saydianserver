import datetime
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('maintenance', pathlib.Path(__file__).with_name('release-disk-maintenance.py'))
maintenance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(maintenance)
NOW = datetime.datetime(2026, 11, 26, tzinfo=datetime.timezone.utc)
REPO = 'ghcr.io/tangwu88/saydianserver-api'


def image(number, created='2026-10-01T00:00:00Z', repo=REPO):
    return {'id': 'sha256:' + f'{number:064x}', 'created': created, 'tags': [repo + ':sha-' + str(number)], 'digests': [], 'size': 100}


class Retention(unittest.TestCase):
    def snapshot(self):
        rows = [image(i, f'2026-10-{i:02d}T00:00:00Z') for i in range(1, 7)]
        return {'used': [rows[0]['id']], 'images': rows}

    def test_preserves_all_container_references_and_two_unused_fallbacks(self):
        self.assertEqual([row['id'] for row in maintenance.eligible(self.snapshot(), NOW)], [image(i)['id'] for i in (2, 3, 4)])

    def test_excludes_other_repositories_and_recent_images(self):
        data = self.snapshot()
        data['images'] += [image(30, '2026-11-25T00:00:00Z'), image(31, repo='other/project')]
        self.assertNotIn(image(30)['id'], [row['id'] for row in maintenance.eligible(data, NOW)])
        self.assertNotIn(image(31)['id'], [row['id'] for row in maintenance.eligible(data, NOW)])

    def test_audit_never_removes_images(self):
        removed = []
        result = maintenance.maintain({'action': 'audit'}, self.snapshot, removed.append, lambda: 1, NOW)
        self.assertEqual(removed, [])
        self.assertEqual(result['removed'], [])

    def test_rejects_protected_or_ambiguous_cleanup(self):
        for selected in ([image(1)['id']], [image(6)['id']], ['not-a-full-id']):
            with self.assertRaises(ValueError):
                maintenance.maintain({'action': 'cleanup', 'images': selected, 'targetFreeBytes': 10 * 1024**3}, self.snapshot, lambda _: self.fail('removed protected image'), lambda: 1, NOW)

    def test_rechecks_all_container_references_before_each_removal(self):
        initial = self.snapshot()
        changed = self.snapshot()
        changed['used'].append(image(2)['id'])
        calls = iter([initial, changed])
        with self.assertRaises(ValueError):
            maintenance.maintain({'action': 'cleanup', 'images': [image(2)['id']], 'targetFreeBytes': 10 * 1024**3}, lambda: next(calls), lambda _: self.fail('removed newly used image'), lambda: 1, NOW)

    def test_removes_only_explicit_ids_and_stops_after_recovering_headroom(self):
        removed = []
        result = maintenance.maintain({'action': 'cleanup', 'images': [image(2)['id'], image(3)['id']], 'targetFreeBytes': 10 * 1024**3}, self.snapshot, removed.append, lambda: 11 * 1024**3 if removed else 1, NOW)
        self.assertEqual(result['removed'], [image(2)['id']])


if __name__ == '__main__':
    unittest.main()
