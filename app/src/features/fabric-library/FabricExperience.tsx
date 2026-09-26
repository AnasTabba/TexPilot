import Feather from '@expo/vector-icons/Feather';
import { useState, type ComponentProps, type PropsWithChildren } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '@/components/ui';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import type { ApiHealth } from '@/hooks/useApiHealth';
import { fabricTheme as t } from '@/theme';
import { fabrics, filterFabrics, type Fabric, type FabricCategory } from './catalog';
import { useFabricLibrary } from './store';

const artwork = {
  denim: require('../../../assets/fabrics/denim.png'),
  cotton: require('../../../assets/fabrics/cotton.png'),
  polyester: require('../../../assets/fabrics/polyester.png'),
};
type IconName = ComponentProps<typeof Feather>['name'];
const categories: FabricCategory[] = ['All', 'Denim', 'Cotton', 'Polyester'];
const slides = [
  {
    image: 'denim',
    title: 'Every fabric has\na story.',
    body: 'Get to know the fabric in your hands.\nOne close-up. A little more clarity.',
    tag: 'MEET YOUR MATERIAL',
    color: t.blue,
  },
  {
    image: 'cotton',
    title: 'Look closer.\nFeel the difference.',
    body: 'Explore textures, weaves and the\nlittle details that make a fabric.',
    tag: 'EXPLORE THE EVERYDAY',
    color: t.paleInk,
  },
  {
    image: 'polyester',
    title: 'A label is just\nthe beginning.',
    body: 'Compare what you see with what\nthe care label says.',
    tag: 'FROM LOOK TO LABEL',
    color: t.red,
  },
] as const;

function Icon({
  name,
  color = t.ink,
  size = 20,
}: {
  name: IconName;
  color?: string;
  size?: number;
}) {
  return <Feather name={name} size={size} color={color} />;
}
function IconButton({
  name,
  label,
  onPress,
  selected = false,
}: {
  name: IconName;
  label: string;
  onPress: () => void;
  selected?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [s.iconButton, pressed && s.pressed]}
    >
      <Icon name={name} color={selected ? t.blue : t.ink} />
    </Pressable>
  );
}
function Action({
  title,
  onPress,
  light = false,
  icon = 'arrow-right',
}: {
  title: string;
  onPress: () => void;
  light?: boolean;
  icon?: IconName;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [s.action, light && s.actionLight, pressed && s.pressed]}
    >
      <Text style={[s.actionText, light && { color: t.blue }]}>{title}</Text>
      <Icon name={icon} color={light ? t.blue : t.white} size={18} />
    </Pressable>
  );
}
function StatusBar({ light = false }: { light?: boolean }) {
  const color = light ? t.white : t.ink;
  return (
    <View
      style={s.status}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text style={[s.time, { color }]}>9:41</Text>
      <View style={s.row}>
        <Icon name="bar-chart" size={13} color={color} />
        <Icon name="wifi" size={13} color={color} />
        <Icon name="battery" size={16} color={color} />
      </View>
    </View>
  );
}
function Phone({
  children,
  blue = false,
  desktop,
}: PropsWithChildren<{ blue?: boolean; desktop: boolean }>) {
  return (
    <View style={[s.phone, desktop ? s.desktopPhone : s.mobilePhone, blue && s.bluePhone]}>
      {desktop && <StatusBar light={blue} />}
      {children}
      {desktop && <View style={[s.homeIndicator, blue && { backgroundColor: t.onBlueMuted }]} />}
    </View>
  );
}

export function FabricExperience({
  onScan,
  onHistory,
  health,
}: {
  onScan: () => void;
  onHistory: () => void;
  health: ApiHealth;
}) {
  const [immersive, setImmersive] = useState(false);
  const desktop = useBreakpoint() === 'expanded' && !immersive;
  const [page, setPage] = useState<'welcome' | 'library' | 'detail'>('welcome');
  const [slide, setSlide] = useState(0);
  const [category, setCategory] = useState<FabricCategory>('All');
  const [query, setQuery] = useState('');
  const [savedOnly, setSavedOnly] = useState(false);
  const [selected, setSelected] = useState<Fabric>(fabrics[0]!);
  const [showTip, setShowTip] = useState(false);
  const savedIds = useFabricLibrary((state) => state.savedIds);
  const toggleSaved = useFabricLibrary((state) => state.toggleSaved);
  const results = filterFabrics(category, query, savedOnly ? savedIds : undefined);
  const currentSlide = slides[slide]!;
  const openFabric = (fabric: Fabric) => {
    setSelected(fabric);
    setShowTip(false);
    setPage('detail');
  };
  const browse = () => {
    setPage('library');
    setSavedOnly(false);
  };

  const welcome = (
    <Phone desktop={desktop} blue>
      <ScrollView
        contentContainerStyle={[s.welcome, { backgroundColor: currentSlide.color }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.welcomeBrand}>
          <View style={s.logoLight}>
            <Icon name="layers" color={t.white} size={20} />
          </View>
          <Text style={s.brandWhite}>
            texpilot<Text style={s.brandDot}>.</Text>
          </Text>
        </View>
        <Text style={s.welcomeEyebrow}>FABRIC VERIFICATION</Text>
        <View style={s.heroArt}>
          <View style={s.heroRing} />
          <View style={s.heroCircle} />
          <Image
            source={artwork[currentSlide.image]}
            style={s.jeansHero}
            resizeMode="contain"
            accessibilityLabel={`${currentSlide.image} garment illustration`}
          />
          <View style={s.heroTag}>
            <Icon name="maximize" size={13} color={t.blue} />
            <Text style={s.heroTagText}>A closer look starts here</Text>
          </View>
        </View>
        <Text style={s.welcomeTitle}>{currentSlide.title}</Text>
        <Text style={s.welcomeBody}>{currentSlide.body}</Text>
        <View style={s.dots}>
          {slides.map((item, index) => (
            <Pressable
              key={item.image}
              accessibilityRole="button"
              accessibilityLabel={`Show ${item.image} introduction`}
              accessibilityState={{ selected: slide === index }}
              onPress={() => setSlide(index)}
              style={s.dotTarget}
            >
              <View style={[s.dot, slide === index && s.activeDot]} />
            </Pressable>
          ))}
        </View>
        <Action
          title="Get started"
          onPress={() => {
            setImmersive(true);
            browse();
          }}
          light
        />
        <Text style={s.welcomeFoot}>A little curiosity. A better understanding.</Text>
      </ScrollView>
    </Phone>
  );

  const library = (
    <Phone desktop={desktop}>
      <ScrollView contentContainerStyle={s.libraryContent} showsVerticalScrollIndicator={false}>
        <View style={s.between}>
          <View style={s.row}>
            <View style={s.logo}>
              <Icon name="layers" color={t.blue} size={19} />
            </View>
            <Text style={s.smallBrand}>texpilot.</Text>
          </View>
          <IconButton
            name="info"
            label="About TexPilot"
            onPress={() => {
              setImmersive(true);
              setPage('welcome');
            }}
          />
        </View>
        <View style={s.greeting}>
          <Text style={s.eyebrow}>A WORLD OF TEXTURES</Text>
          <Text style={s.libraryTitle}>{savedOnly ? 'Your favourites.' : 'Know your fabric.'}</Text>
          <Text style={[s.subtext, !desktop && s.mobileReadable]}>
            Good things start with a closer look.
          </Text>
        </View>
        <View style={s.search}>
          <Icon name="search" size={17} color={t.muted} />
          <TextInput
            accessibilityLabel="Search fabrics"
            placeholder="Search fabrics, textures..."
            placeholderTextColor={t.muted}
            value={query}
            onChangeText={setQuery}
            style={s.searchInput}
          />
          {query !== '' && (
            <IconButton name="x" label="Clear search" onPress={() => setQuery('')} />
          )}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Start a fabric scan"
          onPress={onScan}
          style={s.scanBanner}
        >
          <View style={s.scanIcon}>
            <Icon name="maximize" size={23} color={t.blue} />
          </View>
          <View style={s.flex}>
            <Text style={s.bannerTitle}>Curious about a fabric?</Text>
            <Text style={s.bannerBody}>Take a photo. Check its label.</Text>
          </View>
          <Icon name="arrow-up-right" color={t.blue} size={20} />
        </Pressable>
        <View style={s.between}>
          <Text style={[s.sectionTitle, !desktop && s.mobileReadable]}>Categories</Text>
          <Text style={s.smallMuted}>03 materials</Text>
        </View>
        <View style={s.categories}>
          {categories.map((item) => (
            <Pressable
              key={item}
              accessibilityRole="button"
              accessibilityLabel={`Filter ${item}`}
              accessibilityState={{ selected: category === item }}
              onPress={() => setCategory(item)}
              style={[s.chip, category === item && s.chipActive]}
            >
              {item !== 'All' && (
                <View
                  style={[
                    s.categoryDot,
                    {
                      backgroundColor:
                        item === 'Denim' ? t.blue : item === 'Cotton' ? t.white : t.red,
                    },
                  ]}
                />
              )}
              <Text style={[s.chipText, category === item && s.chipTextActive]}>{item}</Text>
            </Pressable>
          ))}
        </View>
        <View style={s.between}>
          <Text style={[s.sectionTitle, !desktop && s.mobileReadable]}>
            {savedOnly ? 'Saved fabrics' : 'The fabric edit'}
          </Text>
          <Text style={s.smallMuted}>
            {results.length} {results.length === 1 ? 'reference' : 'references'}
          </Text>
        </View>
        <View style={s.grid}>
          {results.map((fabric) => (
            <View key={fabric.id} style={s.card}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`View ${fabric.name}`}
                onPress={() => openFabric(fabric)}
                style={s.cardLink}
              >
                <View
                  style={[
                    s.cardArt,
                    !desktop && s.mobileCardArt,
                    { backgroundColor: t[fabric.image] },
                  ]}
                >
                  <Image
                    source={artwork[fabric.image]}
                    resizeMode="contain"
                    style={[s.cardImage, fabric.id === 'washed-denim' && s.washed]}
                  />
                </View>
                <Text style={[s.cardTitle, !desktop && s.mobileReadable]}>{fabric.name}</Text>
                <Text style={s.cardSubtitle}>{fabric.structure}</Text>
                <View style={s.cardFoot}>
                  <View
                    style={[
                      s.materialDot,
                      {
                        backgroundColor:
                          fabric.category === 'Polyester'
                            ? t.red
                            : fabric.category === 'Denim'
                              ? t.blue
                              : t.paleInk,
                      },
                    ]}
                  />
                  <Text style={s.cardCategory}>{fabric.category}</Text>
                  <Icon name="arrow-up-right" size={12} color={t.muted} />
                </View>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${savedIds.includes(fabric.id) ? 'Unsave' : 'Save'} ${fabric.name}`}
                accessibilityState={{ selected: savedIds.includes(fabric.id) }}
                onPress={() => toggleSaved(fabric.id)}
                style={s.cardSave}
              >
                <Icon
                  name={savedIds.includes(fabric.id) ? 'check' : 'heart'}
                  size={15}
                  color={savedIds.includes(fabric.id) ? t.blue : t.paleInk}
                />
              </Pressable>
            </View>
          ))}
        </View>
        {results.length === 0 && (
          <View style={s.empty}>
            <Icon name={savedOnly ? 'heart' : 'search'} size={28} color={t.muted} />
            <Text style={[s.sectionTitle, !desktop && s.mobileReadable]}>
              {savedOnly ? 'Keep your favourites close' : 'No fabrics found'}
            </Text>
            <Text style={[s.subtext, !desktop && s.mobileReadable]}>
              {savedOnly
                ? 'Tap a heart in the library to save a fabric.'
                : 'Try another name or choose All categories.'}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setQuery('');
                setCategory('All');
                setSavedOnly(false);
              }}
            >
              <Text style={s.link}>Explore all fabrics →</Text>
            </Pressable>
          </View>
        )}
        <Text style={s.libraryNote}>
          Reference guide · Fibre content comes from the care label.
        </Text>
      </ScrollView>
      <View style={s.tabBar}>
        {(
          [
            { icon: 'grid', label: 'Explore', action: browse, active: !savedOnly },
            { icon: 'maximize', label: 'Scan', action: onScan, active: false },
            {
              icon: 'heart',
              label: 'Saved',
              action: () => {
                setSavedOnly(true);
                setPage('library');
              },
              active: savedOnly,
            },
            { icon: 'clock', label: 'History', action: onHistory, active: false },
          ] as const
        ).map((tab) => (
          <Pressable
            key={tab.label}
            accessibilityRole="button"
            accessibilityState={{ selected: tab.active }}
            onPress={tab.action}
            style={s.tab}
          >
            <Icon name={tab.icon} color={tab.active ? t.blue : t.muted} size={19} />
            <Text style={[s.tabText, tab.active && { color: t.blue }]}>{tab.label}</Text>
            {tab.active && <View style={s.tabDot} />}
          </Pressable>
        ))}
      </View>
    </Phone>
  );

  const detail = (
    <Phone desktop={desktop}>
      <ScrollView contentContainerStyle={s.detailContent} showsVerticalScrollIndicator={false}>
        <View style={[s.detailArt, { backgroundColor: t[selected.image] }]}>
          <View style={s.detailTop}>
            <IconButton name="arrow-left" label="Back to fabric library" onPress={browse} />
            <View style={s.referencePill}>
              <Text style={s.referenceText}>FABRIC GUIDE</Text>
            </View>
            <IconButton
              name={savedIds.includes(selected.id) ? 'check' : 'heart'}
              label={`${savedIds.includes(selected.id) ? 'Unsave' : 'Save'} selected fabric`}
              selected={savedIds.includes(selected.id)}
              onPress={() => toggleSaved(selected.id)}
            />
          </View>
          <View style={s.detailCircle} />
          <Image
            source={artwork[selected.image]}
            resizeMode="contain"
            style={s.detailImage}
            accessibilityLabel={selected.name}
          />
        </View>
        <View style={s.detailBody}>
          <View style={s.between}>
            <View>
              <Text style={[s.detailTitle, !desktop && s.mobileTitle]}>{selected.name}</Text>
              <Text style={[s.subtext, !desktop && s.mobileReadable]}>{selected.subtitle}</Text>
            </View>
            <View style={[s.materialPill, { backgroundColor: t[selected.image] }]}>
              <Text style={s.materialText}>{selected.category}</Text>
            </View>
          </View>
          <View style={s.attributes}>
            {[
              { label: 'STRUCTURE', value: selected.structure },
              { label: 'HANDLE', value: selected.feel },
              { label: 'WEIGHT', value: selected.weight },
            ].map((attribute) => (
              <View key={attribute.label} style={s.attribute}>
                <Text style={s.attributeLabel}>{attribute.label}</Text>
                <Text style={[s.attributeValue, !desktop && s.mobileReadable]}>
                  {attribute.value}
                </Text>
              </View>
            ))}
          </View>
          <Text style={[s.sectionTitle, !desktop && s.mobileReadable]}>
            A little about this fabric
          </Text>
          <Text style={[s.description, !desktop && s.mobileReadable]}>{selected.description}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showTip }}
            onPress={() => setShowTip(!showTip)}
            style={s.tip}
          >
            <View style={s.row}>
              <Icon name="sun" color={t.blue} size={18} />
              <Text style={s.tipTitle}>Tips for a better scan</Text>
            </View>
            <Icon name={showTip ? 'minus' : 'plus'} color={t.blue} size={16} />
          </Pressable>
          {showTip && <Text style={[s.tipBody, !desktop && s.mobileReadable]}>{selected.tip}</Text>}
          <View style={s.evidence}>
            <Icon name="info" size={14} color={t.muted} />
            <Text style={[s.evidenceText, !desktop && s.mobileReadable]}>
              A photo shows texture, not exact composition. Always check the care label.
            </Text>
          </View>
        </View>
      </ScrollView>
      <View style={s.detailFooter}>
        <Action title="Scan a fabric like this" icon="maximize" onPress={onScan} />
        <Text style={s.footerNote}>Fabric photo + care label = a clearer picture</Text>
      </View>
    </Phone>
  );

  return (
    <SafeAreaView
      style={[s.root, desktop && s.desktopRoot]}
      edges={['top', 'bottom', 'left', 'right']}
    >
      {desktop ? (
        <ScrollView contentContainerStyle={s.stage}>
          <View style={s.stageHeader}>
            <View style={s.row}>
              <View style={s.stageLogo}>
                <Icon name="layers" color={t.white} size={21} />
              </View>
              <Text style={s.stageBrand}>texpilot.</Text>
              <View style={s.headerDivider} />
              <Text style={s.stageTagline}>A closer look at what you wear.</Text>
            </View>
            <View style={s.previewPill}>
              <View style={s.liveDot} />
              <Text style={s.previewText}>INTERACTIVE APP PREVIEW</Text>
            </View>
          </View>
          <View style={s.stageIntro}>
            <Text style={s.stageEyebrow}>MADE FOR THE CURIOUS</Text>
            <Text style={s.stageTitle}>Good fabric. Better understanding.</Text>
            <Text style={s.stageSubtitle}>
              Explore the textures. Know the details. Start with a scan.
            </Text>
          </View>
          <View style={s.phones}>
            <View style={s.phoneColumn}>
              {welcome}
              <Text style={s.phoneCaption}>01 / A little introduction</Text>
            </View>
            <View style={s.phoneColumn}>
              {library}
              <Text style={s.phoneCaption}>02 / Find your fabric</Text>
            </View>
            <View style={s.phoneColumn}>
              {detail}
              <Text style={s.phoneCaption}>03 / Get to know it</Text>
            </View>
          </View>
          <View style={s.stageFooter}>
            <Text style={s.stageFooterText}>DESIGNED TO EXPLORE. BUILT TO VERIFY.</Text>
            <Text style={s.stageFooterText}>Denim blues. Cotton whites. A new perspective.</Text>
          </View>
        </ScrollView>
      ) : (
        <View style={s.mobileContainer}>
          {page === 'welcome' ? welcome : page === 'detail' ? detail : library}
        </View>
      )}
      {page === 'library' && !desktop && (
        <View style={s.connection}>
          <Text style={s.connectionText}>
            {health === 'online'
              ? 'Scanner connected'
              : health === 'checking'
                ? 'Checking scanner connection…'
                : 'Library available · scanner server offline'}
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  mobileReadable: { fontSize: t.type.body, lineHeight: 21 },
  mobileTitle: { fontSize: t.type.title },
  mobileCardArt: { height: 138 },
  root: { flex: 1, backgroundColor: t.white },
  desktopRoot: { backgroundColor: t.stage },
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: t.space.sm },
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: t.space.sm,
  },
  pressed: { opacity: 0.7 },
  stage: {
    paddingHorizontal: t.space.stage,
    paddingTop: t.space.xl,
    paddingBottom: t.space.lg,
    alignItems: 'center',
  },
  stageHeader: {
    width: '100%',
    maxWidth: 1300,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stageLogo: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: t.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stageBrand: { fontSize: t.type.brand, fontWeight: '800', color: t.ink, letterSpacing: -1 },
  headerDivider: { width: 1, height: 22, backgroundColor: t.line, marginHorizontal: t.space.md },
  stageTagline: { color: t.paleInk, fontSize: t.type.caption },
  previewPill: {
    flexDirection: 'row',
    gap: t.space.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: t.white,
    borderRadius: 20,
    paddingHorizontal: t.space.md,
    paddingVertical: t.space.sm,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: t.blue },
  previewText: { fontSize: 9, fontWeight: '600', letterSpacing: 1.2, color: t.paleInk },
  stageIntro: {
    alignItems: 'center',
    marginTop: t.space.xl,
    marginBottom: t.space.xl,
    gap: t.space.sm,
  },
  stageEyebrow: { fontSize: 9, fontWeight: '700', letterSpacing: 2.5, color: t.blue },
  stageTitle: { fontSize: 28, fontWeight: '700', letterSpacing: -0.8, color: t.ink },
  stageSubtitle: { fontSize: t.type.caption, color: t.muted },
  phones: {
    width: '100%',
    maxWidth: 1034,
    flexDirection: 'row',
    gap: t.space.xl,
    alignItems: 'flex-start',
  },
  phoneColumn: { flex: 1, alignItems: 'center', gap: t.space.lg },
  phoneCaption: { fontSize: t.type.micro, color: t.paleInk, letterSpacing: 0.7 },
  stageFooter: {
    width: '100%',
    maxWidth: 1300,
    marginTop: t.space.xxl,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  stageFooterText: { fontSize: 9, color: t.muted, letterSpacing: 1 },
  phone: { backgroundColor: t.white, overflow: 'hidden' },
  desktopPhone: {
    width: '100%',
    height: t.phoneHeight,
    borderRadius: t.phoneRadius,
    borderWidth: 6,
    borderColor: t.white,
    boxShadow: `0 16px 50px ${t.shadow}`,
  },
  mobilePhone: { flex: 1, width: '100%' },
  bluePhone: { backgroundColor: t.blue },
  mobileContainer: { flex: 1, width: '100%', maxWidth: 520, alignSelf: 'center' },
  status: {
    height: 34,
    paddingHorizontal: t.space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  time: { fontSize: t.type.small, fontWeight: '700' },
  homeIndicator: {
    height: 4,
    width: 95,
    borderRadius: 5,
    alignSelf: 'center',
    backgroundColor: t.ink,
    marginTop: t.space.sm,
    marginBottom: t.space.sm,
    opacity: 0.8,
  },
  welcome: {
    flexGrow: 1,
    paddingHorizontal: t.space.xl,
    paddingTop: t.space.lg,
    paddingBottom: t.space.md,
    alignItems: 'center',
  },
  welcomeBrand: { flexDirection: 'row', alignItems: 'center', gap: t.space.sm },
  logoLight: { width: 29, height: 29, alignItems: 'center', justifyContent: 'center' },
  brandWhite: { fontSize: 25, fontWeight: '700', color: t.white, letterSpacing: -1 },
  brandDot: { color: t.onBlueMuted },
  welcomeEyebrow: { color: t.onBlueMuted, fontSize: 8, letterSpacing: 2.8, marginTop: t.space.sm },
  heroArt: {
    width: '100%',
    height: 277,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: t.space.lg,
    marginBottom: t.space.md,
  },
  heroRing: {
    position: 'absolute',
    width: 248,
    height: 248,
    borderRadius: 124,
    borderWidth: 1,
    borderColor: t.heroLine,
    opacity: 0.65,
  },
  heroCircle: {
    position: 'absolute',
    width: 216,
    height: 216,
    borderRadius: 108,
    backgroundColor: t.heroCircle,
    opacity: 0.8,
  },
  jeansHero: { width: 260, height: 284, transform: [{ rotate: '-12deg' }] },
  heroTag: {
    position: 'absolute',
    bottom: 5,
    right: -8,
    borderRadius: 12,
    paddingHorizontal: t.space.md,
    paddingVertical: t.space.sm,
    backgroundColor: t.white,
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.space.sm,
    transform: [{ rotate: '-5deg' }],
  },
  heroTagText: { fontSize: 9, fontWeight: '600', color: t.blue },
  welcomeTitle: {
    color: t.white,
    fontSize: 30,
    lineHeight: 35,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: -0.8,
  },
  welcomeBody: {
    color: t.onBlueMuted,
    fontSize: t.type.caption,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: t.space.md,
  },
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: t.space.sm,
  },
  dotTarget: { width: 32, height: 48, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 5, height: 5, borderRadius: 5, backgroundColor: t.heroLine },
  activeDot: { width: 19, backgroundColor: t.white },
  action: {
    minHeight: 50,
    width: '100%',
    backgroundColor: t.blue,
    borderRadius: 14,
    paddingHorizontal: t.space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.space.md,
  },
  actionLight: { backgroundColor: t.white },
  actionText: { color: t.white, fontSize: t.type.body, fontWeight: '600' },
  welcomeFoot: { color: t.onBlueMuted, fontSize: 8, textAlign: 'center', marginTop: t.space.md },
  libraryContent: { paddingHorizontal: t.space.lg, paddingBottom: t.space.md, gap: t.space.md },
  logo: {
    width: 31,
    height: 31,
    borderRadius: 10,
    backgroundColor: t.blueSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallBrand: { fontSize: t.type.heading, fontWeight: '700', letterSpacing: -0.6, color: t.ink },
  iconButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: t.white,
  },
  greeting: { gap: t.space.xs },
  eyebrow: { fontSize: 8, color: t.muted, letterSpacing: 1.6, fontWeight: '600' },
  libraryTitle: { fontSize: t.type.title, fontWeight: '700', color: t.ink, letterSpacing: -0.8 },
  subtext: { fontSize: t.type.small, color: t.muted, lineHeight: 17 },
  search: {
    backgroundColor: t.stage,
    borderRadius: 13,
    minHeight: 46,
    paddingLeft: t.space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.space.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: t.type.small,
    color: t.ink,
    paddingVertical: t.space.md,
    outlineWidth: 0,
  },
  scanBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.space.sm,
    padding: t.space.md,
    backgroundColor: t.blueSoft,
    borderRadius: 15,
  },
  scanIcon: { width: 35, height: 35, alignItems: 'center', justifyContent: 'center' },
  bannerTitle: { fontSize: t.type.small, fontWeight: '700', color: t.ink },
  bannerBody: { fontSize: 9, color: t.paleInk, marginTop: t.space.xs },
  sectionTitle: { fontSize: t.type.body, color: t.ink, fontWeight: '700' },
  smallMuted: { fontSize: 9, color: t.muted },
  categories: { flexDirection: 'row', gap: t.space.xs },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.space.xs,
    paddingHorizontal: t.space.sm,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: t.stage,
    flexGrow: 1,
  },
  chipActive: { backgroundColor: t.blue },
  chipText: { fontSize: 10, color: t.paleInk, fontWeight: '600' },
  chipTextActive: { color: t.white },
  categoryDot: { width: 7, height: 7, borderRadius: 4, borderWidth: 1, borderColor: t.line },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space.md },
  card: {
    width: '47%',
    position: 'relative',
    borderRadius: 15,
    borderWidth: 1,
    borderColor: t.line,
    overflow: 'hidden',
    backgroundColor: t.white,
  },
  cardLink: { padding: t.space.xs },
  cardArt: { height: 108, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  cardImage: { width: '85%', height: 100 },
  washed: { opacity: 0.68, transform: [{ rotate: '12deg' }] },
  cardTitle: {
    color: t.ink,
    fontSize: t.type.small,
    fontWeight: '700',
    marginTop: t.space.sm,
    marginHorizontal: t.space.xs,
  },
  cardSubtitle: {
    fontSize: 9,
    color: t.muted,
    marginTop: t.space.xs,
    marginHorizontal: t.space.xs,
  },
  cardFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.space.xs,
    marginHorizontal: t.space.xs,
    marginTop: t.space.sm,
    marginBottom: t.space.xs,
  },
  materialDot: { width: 4, height: 4, borderRadius: 2 },
  cardCategory: { fontSize: 8, color: t.paleInk, flex: 1 },
  cardSave: {
    position: 'absolute',
    top: 1,
    right: 1,
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  libraryNote: { fontSize: 8, lineHeight: 13, color: t.muted, textAlign: 'center' },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderColor: t.line,
    paddingTop: t.space.sm,
    backgroundColor: t.white,
    paddingHorizontal: t.space.sm,
  },
  tab: { flex: 1, minHeight: 48, alignItems: 'center', gap: t.space.xs },
  tabText: { fontSize: 8, color: t.muted },
  tabDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: t.blue },
  empty: { paddingVertical: t.space.xl, gap: t.space.md, alignItems: 'center' },
  link: { fontSize: t.type.caption, color: t.blue, paddingVertical: t.space.md },
  detailContent: { paddingHorizontal: t.space.md },
  detailArt: { height: 266, borderRadius: 23, alignItems: 'center', overflow: 'hidden' },
  detailTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    padding: t.space.sm,
    zIndex: 1,
  },
  referencePill: { paddingHorizontal: t.space.sm, paddingVertical: t.space.sm },
  referenceText: { fontSize: 8, letterSpacing: 1.4, fontWeight: '600', color: t.paleInk },
  detailCircle: {
    position: 'absolute',
    top: 63,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: t.white,
    opacity: 0.35,
  },
  detailImage: {
    width: 205,
    height: 221,
    position: 'absolute',
    top: 34,
    transform: [{ rotate: '-9deg' }],
  },
  artDots: { flexDirection: 'row', gap: t.space.xs, position: 'absolute', bottom: 10 },
  detailBody: { paddingHorizontal: t.space.sm, paddingTop: t.space.lg, gap: t.space.md },
  detailTitle: { fontSize: 22, fontWeight: '700', color: t.ink, letterSpacing: -0.6 },
  materialPill: { borderRadius: 9, paddingHorizontal: t.space.sm, paddingVertical: t.space.sm },
  materialText: { fontSize: 8, color: t.paleInk, fontWeight: '600' },
  attributes: {
    flexDirection: 'row',
    gap: t.space.sm,
    paddingVertical: t.space.md,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: t.line,
  },
  attribute: { flex: 1, gap: t.space.sm },
  attributeLabel: { fontSize: 7, letterSpacing: 0.7, color: t.muted },
  attributeValue: { fontSize: 9, color: t.ink, fontWeight: '600' },
  description: { fontSize: t.type.small, lineHeight: 18, color: t.paleInk },
  tip: {
    borderRadius: 12,
    backgroundColor: t.blueSoft,
    paddingHorizontal: t.space.md,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tipTitle: { fontSize: t.type.small, fontWeight: '600', color: t.blue },
  tipBody: { fontSize: t.type.small, lineHeight: 18, color: t.paleInk },
  evidence: { flexDirection: 'row', alignItems: 'flex-start', gap: t.space.sm },
  evidenceText: { fontSize: 9, lineHeight: 15, color: t.muted, flex: 1 },
  detailFooter: { paddingHorizontal: t.space.lg, paddingTop: t.space.md },
  footerNote: { fontSize: 8, color: t.muted, textAlign: 'center', marginTop: t.space.sm },
  connection: { padding: t.space.xs, alignItems: 'center', backgroundColor: t.stage },
  connectionText: { fontSize: 9, color: t.paleInk },
});
