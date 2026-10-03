import { describeUrl, redact } from '../../src/utils/diagnostics/playback-log'

jest.mock('../../src/stores/auth/utils', () => ({ getApi: jest.fn() }))

const SERVER = 'https://music.example.com'

describe('playback log redaction', () => {
	it('removes the server address', () => {
		expect(redact(`URL for X: ${SERVER}/Audio/1/stream?static=true`, SERVER)).toBe(
			'URL for X: <server>/Audio/1/stream?static=true',
		)
	})

	it('removes API keys in any casing, including in transcoding URLs', () => {
		const text = `${SERVER}/Audio/1/stream.aac?ApiKey=abc123&AudioCodec=aac api_key=def456`
		const result = redact(text, SERVER)

		expect(result).not.toContain('abc123')
		expect(result).not.toContain('def456')
		expect(result).toContain('AudioCodec=aac')
	})

	it('removes tokens from authorization headers', () => {
		const result = redact('MediaBrowser Client="Jellify", Token="secret-token"', undefined)

		expect(result).not.toContain('secret-token')
	})

	it('leaves text alone when there is no server address yet', () => {
		expect(redact('state playing', undefined)).toBe('state playing')
	})
})

describe('describeUrl', () => {
	it('distinguishes a missing URL, a local file and a stream', () => {
		expect(describeUrl('')).toBe('NO URL')
		expect(describeUrl(undefined)).toBe('NO URL')
		expect(describeUrl('file:///var/mobile/a.flac')).toBe('local file')
		expect(describeUrl('/var/mobile/a.flac')).toBe('local file')
		expect(describeUrl(`${SERVER}/Audio/1/stream`)).toBe(`${SERVER}/Audio/1/stream`)
	})
})
