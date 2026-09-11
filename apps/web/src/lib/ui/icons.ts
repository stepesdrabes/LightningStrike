/** Map app concepts to Lucide glyphs; deep imports avoid the full icon barrel. */
import AudioLines from 'lucide-svelte/icons/audio-lines';
import Check from 'lucide-svelte/icons/check';
import ChevronDown from 'lucide-svelte/icons/chevron-down';
import ChevronRight from 'lucide-svelte/icons/chevron-right';
import ChevronUp from 'lucide-svelte/icons/chevron-up';
import Lamp from 'lucide-svelte/icons/lamp';
import Link from 'lucide-svelte/icons/link';
import ListMusic from 'lucide-svelte/icons/list-music';
import ListPlus from 'lucide-svelte/icons/list-plus';
import Music from 'lucide-svelte/icons/music';
import PanelLeft from 'lucide-svelte/icons/panel-left';
import PanelRight from 'lucide-svelte/icons/panel-right';
import Pause from 'lucide-svelte/icons/pause';
import Play from 'lucide-svelte/icons/play';
import Plus from 'lucide-svelte/icons/plus';
import QrCode from 'lucide-svelte/icons/qr-code';
import Radio from 'lucide-svelte/icons/radio';
import RotateCcw from 'lucide-svelte/icons/rotate-ccw';
import Search from 'lucide-svelte/icons/search';
import Shuffle from 'lucide-svelte/icons/shuffle';
import Star from 'lucide-svelte/icons/star';
import MapPin from 'lucide-svelte/icons/map-pin';
import SkipBack from 'lucide-svelte/icons/skip-back';
import SkipForward from 'lucide-svelte/icons/skip-forward';
import Sparkles from 'lucide-svelte/icons/sparkles';
import Trash2 from 'lucide-svelte/icons/trash-2';
import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
import Volume2 from 'lucide-svelte/icons/volume-2';
import VolumeX from 'lucide-svelte/icons/volume-x';
import X from 'lucide-svelte/icons/x';
import Zap from 'lucide-svelte/icons/zap';

export const GLYPHS = {
	alert: TriangleAlert,
	bands: AudioLines,
	bolt: Zap,
	check: Check,
	chevronDown: ChevronDown,
	chevronRight: ChevronRight,
	chevronUp: ChevronUp,
	lounge: Lamp,
	link: Link,
	listMusic: ListMusic,
	music: Music,
	panelLeft: PanelLeft,
	panelRight: PanelRight,
	pause: Pause,
	play: Play,
	playNext: ListPlus,
	plus: Plus,
	qr: QrCode,
	radio: Radio,
	retry: RotateCcw,
	search: Search,
	shuffle: Shuffle,
	star: Star,
	pin: MapPin,
	skipBack: SkipBack,
	skipForward: SkipForward,
	sparkles: Sparkles,
	trash: Trash2,
	volume: Volume2,
	volumeOff: VolumeX,
	x: X
};

export type IconName = keyof typeof GLYPHS;
