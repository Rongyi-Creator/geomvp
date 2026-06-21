export const ORIGIN_HOST = 'https://www.virumakupunktur.dk';
export const CANONICAL_HOST = 'https://virumakupunktur.dk';

export const BUSINESS = {
  "@context": "https://schema.org",
  "@type": "MedicalBusiness",
  "name": "Virum Akupunktur",
  "legalName": "Jantek ApS",
  "description": "Virum Akupunktur tilbyder en unik holistisk service til kunder gennem evaluering og skabelse af passende behandlingsforløb baseret på Traditionel Kinesisk Medicin. Klinikken specialiserer sig i sikre, effektive og afslappende smertebehandlinger.",
  "url": "https://virumakupunktur.dk",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "Dalstrøget 78, 4. sal",
    "addressLocality": "Dyssegård",
    "postalCode": "2870",
    "addressCountry": "DK"
  },
  "geo": {
    "@type": "GeoCoordinates",
    "latitude": 55.7367,
    "longitude": 12.5186
  },
  "medicalSpecialty": "Smertebehandling"
};

export const FAQ_ITEMS = [
  {
    "question": "Hvad er akupunktur?",
    "answer": "Akupunktur er en flere tusinde år gammel behandlingsform, der har sin oprindelse i Traditionel Kinesisk Medicin."
  },
  {
    "question": "Hvordan foregår en akupunkturbehandling?",
    "answer": "Det 1. besøg hos Virum Akupunktur starter altid med en indledende samtale, hvor akupunktøren danner sig et indtryk af patienten, og den første behandling starter med en grundig undersøgelse, hvor diagnosen stilles ifølge TCM's teori."
  },
  {
    "question": "Hvad koster første behandling?",
    "answer": "Specialtilbud for første prøvebehandling ca. 75 min. med gratis undersøgelse og behandling koster 450 kr."
  },
  {
    "question": "Hvor er klinikken placeret, og er der parkering?",
    "answer": "Virum Akupunktur ligger på Dalstrøget 78, 4. sal, 2870 Dyssegård (tag elevator til 4. sal). Der er ubegrænset parkering ved Dalstrøget parkeringsplads. Bus linjerne 164, 4A og 6A kører i nærheden."
  },
  {
    "question": "Tilbyder Virum Akupunktur gratis konsultation?",
    "answer": "Ja, Virum Akupunktur tilbyder gratis konsultation."
  }
];

export const SERVICES: Record<string, { name: string; description: string }> = {
  "/our-team/akupunktur-behandling/": { name: "Akupunktur behandling", description: "Generel akupunkturbehandling baseret på TCM-diagnose og individuelt tilpasset behandlingsforløb." },
  "/our-team/smertebehandling/": { name: "Smertebehandling", description: "Behandling af mange forskellige typer smerter, herunder akutte smerter og smerter fra sportsudøvelse." },
  "/our-team/eksem/": { name: "Eksem", description: "Akupunktur mod eksem, som skønnes at ramme mere end 10% af befolkningen hvert år i lettere eller sværere grad." },
  "/our-team/fedme-og-overv-gt/": { name: "Fedme og overvægt", description: "Akupunkturbehandling til støtte ved fedme og overvægt." },
  "/our-team/ford-jelsesproblemer/": { name: "Fordøjelsesproblemer", description: "Akupunkturbehandling af fordøjelsesproblemer." },
  "/our-team/frossen-skulder/": { name: "Frossen skulder", description: "Akupunkturbehandling af frossen skulder og relaterede smerter." },
  "/our-team/h-morider/": { name: "Hæmorider", description: "Akupunkturbehandling af hæmorider." },
  "/our-team/helvedesild-hurtig-smertelindring/": { name: "Helvedesild hurtig Smertelindring", description: "Hurtig smertelindring ved helvedesild med akupunktur." },
  "/our-team/herpes-og-fork-lelsess-r/": { name: "Herpes og forkølelsessår", description: "Akupunkturbehandling mod herpes og forkølelsessår." },
  "/our-team/hjertebanken/": { name: "Hjertebanken", description: "Akupunkturbehandling ved hjertebanken." },
  "/our-team/h-jt-og-lavt-blodtryk/": { name: "Højt og lavt blodtryk", description: "Akupunkturbehandling til regulering af højt og lavt blodtryk." },
  "/our-team/hormonelle-ubalancer/": { name: "Hormonelle ubalancer", description: "Akupunkturbehandling af hormonelle ubalancer." },
  "/our-team/hovedpine-og-migr-ne/": { name: "Hovedpine og migræne", description: "Akupunkturbehandling mod hovedpine og migræne." },
  "/our-team/irriteret-tyktarm/": { name: "Irriteret tyktarm", description: "Akupunkturbehandling af irriteret tyktarm." },
  "/our-team/iskias/": { name: "Iskias", description: "Akupunkturbehandling af iskias og relaterede smerter." },
  "/our-team/l-ndesmerter/": { name: "Lændesmerter", description: "Akupunkturbehandling af lændesmerter." },
  "/our-team/leddegigt-og-slidgigt/": { name: "Leddegigt og slidgigt", description: "Akupunkturbehandling af leddegigt og slidgigt." },
  "/our-team/maves-r/": { name: "Mavesår", description: "Akupunkturbehandling af mavesår." },
  "/our-team/mavesyre-og-halsbrand/": { name: "Mavesyre og halsbrand", description: "Akupunkturbehandling mod mavesyre og halsbrand." },
  "/our-team/menstruationssmerter-og-endometriose/": { name: "Menstruationssmerter og endometriose", description: "Akupunkturbehandling af menstruationssmerter og endometriose." },
  "/our-team/morbus-crohn-og-colitis/": { name: "Morbus Crohn og Colitis", description: "Akupunkturbehandling ved Morbus Crohn og Colitis." },
  "/our-team/musearm-og-tennisalbue/": { name: "Musearm og tennisalbue", description: "Akupunkturbehandling af musearm og tennisalbue." },
  "/our-team/muskelsp-ndinger-og-myoser/": { name: "Muskelspændinger og myoser", description: "Akupunkturbehandling af muskelspændinger og myoser." },
  "/our-team/demer-og-v-skeophobning/": { name: "Ødemer og væskeophobning", description: "Akupunkturbehandling af ødemer og væskeophobning." },
  "/our-team/overgangsalder/": { name: "Overgangsalder", description: "Akupunkturbehandling af symptomer ved overgangsalder." },
  "/our-team/piskesm-ld-whiplash/": { name: "Piskesmæld – whiplash", description: "Akupunkturbehandling af piskesmæld og whiplash." },
  "/our-team/pms/": { name: "PMS", description: "Akupunkturbehandling af PMS-symptomer." },
  "/our-team/prostata/": { name: "Prostata", description: "Akupunkturbehandling ved prostataproblemer." },
  "/our-team/psoriasis/": { name: "Psoriasis", description: "Akupunkturbehandling af psoriasis." },
  "/our-team/rygestop/": { name: "Rygestop", description: "Akupunktur som støtte til rygestop." },
  "/our-team/rygsmerter/": { name: "Rygsmerter", description: "Akupunkturbehandling af rygsmerter." },
  "/our-team/rynker-og-kosmetisk-akupunktur/": { name: "Rynker og kosmetisk akupunktur", description: "Kosmetisk akupunktur til behandling af rynker og hudpleje." },
};

interface PageMeta {
  pageType: string;
  metaTitle: string;
  metaDescription: string;
}

export const PAGES_META: Record<string, PageMeta> = {
  "/": { pageType: "home", metaTitle: "Akupunktur i Dyssegård | Virum Akupunktur", metaDescription: "Virum Akupunktur tilbyder professionel akupunkturbehandling i Dyssegård. Smertebehandling, kosmetisk akupunktur, rygestop og meget mere. Book en tid i dag." },
  "/contact/": { pageType: "contact", metaTitle: "Kontakt Virum Akupunktur i Dyssegård | Virum Akupunktur", metaDescription: "Kontakt Virum Akupunktur i Dyssegård. Find adresse, telefon og åbningstider. Book din akupunkturbehandling nemt og hurtigt." },
  "/our-team/": { pageType: "service", metaTitle: "Akupunkturbehandlinger i Dyssegård | Virum Akupunktur", metaDescription: "Se alle akupunkturbehandlinger hos Virum Akupunktur i Dyssegård. Vi behandler smerter, hudlidelser, fordøjelsesproblemer, hormonelle ubalancer og meget mere." },
  "/services/": { pageType: "prices", metaTitle: "Priser og åbningstider i Dyssegård | Virum Akupunktur", metaDescription: "Se priser og åbningstider for akupunkturbehandling hos Virum Akupunktur i Dyssegård. Gennemsigtige priser og fleksible tider." },
  "/our-team/akupunktur-behandling/": { pageType: "service", metaTitle: "Akupunktur behandling i Dyssegård | Virum Akupunktur", metaDescription: "Få professionel akupunkturbehandling hos Virum Akupunktur i Dyssegård. Effektiv behandling baseret på traditionel kinesisk medicin. Book din tid i dag." },
  "/our-team/hvad-er-akupunktur/": { pageType: "faq", metaTitle: "Hvad er akupunktur? | Virum Akupunktur i Dyssegård", metaDescription: "Lær hvad akupunktur er, og hvordan det virker. Virum Akupunktur i Dyssegård forklarer metoden og dens fordele for din sundhed." },
  "/our-team/hvordan-foreg-r-en-behandling/": { pageType: "faq", metaTitle: "Hvordan foregår en akupunkturbehandling? | Virum Akupunktur i Dyssegård", metaDescription: "Få svar på, hvordan en akupunkturbehandling foregår hos Virum Akupunktur i Dyssegård. Vi guider dig trygt gennem hele forløbet." },
  "/our-team/smertebehandling/": { pageType: "service", metaTitle: "Smertebehandling med akupunktur i Dyssegård | Virum Akupunktur", metaDescription: "Effektiv smertebehandling med akupunktur hos Virum Akupunktur i Dyssegård. Lindring af kroniske og akutte smerter – book en behandling i dag." },
  "/our-team/eksem/": { pageType: "service", metaTitle: "Eksem behandling med akupunktur i Dyssegård | Virum Akupunktur", metaDescription: "Lider du af eksem? Virum Akupunktur i Dyssegård tilbyder akupunkturbehandling mod eksem og kløende hud. Naturlig og effektiv lindring." },
  "/our-team/fedme-og-overv-gt/": { pageType: "service", metaTitle: "Fedme og overvægt behandling i Dyssegård | Virum Akupunktur", metaDescription: "Akupunktur mod fedme og overvægt hos Virum Akupunktur i Dyssegård. Støt din vægttabsrejse med naturlig behandling. Book en tid i dag." },
  "/our-team/ford-jelsesproblemer/": { pageType: "service", metaTitle: "Fordøjelsesproblemer behandlet med akupunktur i Dyssegård | Virum Akupunktur", metaDescription: "Akupunktur mod fordøjelsesproblemer hos Virum Akupunktur i Dyssegård. Effektiv behandling af maveproblemer, oppustethed og ubehag." },
  "/our-team/frossen-skulder/": { pageType: "service", metaTitle: "Frossen skulder behandling med akupunktur i Dyssegård | Virum Akupunktur", metaDescription: "Frossen skulder? Virum Akupunktur i Dyssegård tilbyder effektiv akupunkturbehandling mod stivhed og smerter i skulderen. Book din tid." },
  "/our-team/h-morider/": { pageType: "service", metaTitle: "Hæmorider behandlet med akupunktur i Dyssegård | Virum Akupunktur", metaDescription: "Akupunktur mod hæmorider hos Virum Akupunktur i Dyssegård. Naturlig smertelindring og behandling af hæmorider uden bivirkninger." },
  "/our-team/helvedesild-hurtig-smertelindring/": { pageType: "service", metaTitle: "Helvedesild – hurtig smertelindring med akupunktur i Dyssegård | Virum Akupunktur", metaDescription: "Hurtig smertelindring ved helvedesild med akupunktur hos Virum Akupunktur i Dyssegård. Effektiv og naturlig behandling af nervesmerter." },
  "/our-team/herpes-og-fork-lelsess-r/": { pageType: "service", metaTitle: "Herpes og forkølelsessår behandlet med akupunktur i Dyssegård | Virum Akupunktur", metaDescription: "Akupunktur mod herpes og forkølelsessår hos Virum Akupunktur i Dyssegård. Styrk immunforsvaret og lindre symptomerne naturligt." },
  "/our-team/hjertebanken/": { pageType: "service", metaTitle: "Hjertebanken behandlet med akupunktur i Dyssegård | Virum Akupunktur", metaDescription: "Oplever du hjertebanken? Virum Akupunktur i Dyssegård tilbyder akupunkturbehandling der kan hjælpe med at regulere og berolige hjerterytmen." },
  "/our-team/hormonelle-ubalancer/": { pageType: "service", metaTitle: "Hormonelle ubalancer behandlet med akupunktur i Dyssegård | Virum Akupunktur", metaDescription: "Akupunktur mod hormonelle ubalancer hos Virum Akupunktur i Dyssegård. Naturlig behandling der støtter hormonsystemet og genopretter balance." },
  "/our-team/hovedpine-og-migr-ne/": { pageType: "service", metaTitle: "Hovedpine og migræne behandlet med akupunktur i Dyssegård | Virum Akupunktur", metaDescription: "Lider du af hovedpine eller migræne? Virum Akupunktur i Dyssegård tilbyder effektiv akupunkturbehandling mod smerte og anfald." },
  "/our-team/h-jt-og-lavt-blodtryk/": { pageType: "service", metaTitle: "Højt og lavt blodtryk behandlet med akupunktur i Dyssegård | Virum Akupunktur", metaDescription: "Akupunktur mod højt og lavt blodtryk hos Virum Akupunktur i Dyssegård. Naturlig behandling der hjælper med at stabilisere blodtrykket." },
  "/our-team/irriteret-tyktarm/": { pageType: "service", metaTitle: "Irriteret tyktarm behandlet med akupunktur i Dyssegård | Virum Akupunktur", metaDescription: "Akupunktur mod irriteret tyktarm (IBS) hos Virum Akupunktur i Dyssegård. Lindring af mavekramper, oppustethed og uregelmæssig afføring." },
  "/our-team/iskias/": { pageType: "service", metaTitle: "Iskias behandlet med akupunktur i Dyssegård | Virum Akupunktur", metaDescription: "Akupunktur mod iskias hos Virum Akupunktur i Dyssegård. Effektiv smertelindring ved udstråling i ben og ryg. Book din behandling i dag." },
  "/our-team/l-ndesmerter/": { pageType: "service", metaTitle: "Lændesmerter behandlet med akupunktur i Dyssegård | Virum Akupunktur", metaDescription: "Akupunktur mod lændesmerter hos Virum Akupunktur i Dyssegård. Effektiv og naturlig smertelindring i lænderyggen. Book en tid i dag." },
  "/our-team/leddegigt-og-slidgigt/": { pageType: "service", metaTitle: "Leddegigt og slidgigt behandlet med akupunktur i Dyssegård | Virum Akupunktur", metaDescription: "Akupunktur mod leddegigt og slidgigt hos Virum Akupunktur i Dyssegård. Lindring af ledsmerter og stivhed med naturlig behandling." },
  "/our-team/maves-r/": { pageType: "service", metaTitle: "Mavesår behandlet med akupunktur i Dyssegård | Virum Akupunktur", metaDescription: "Akupunktur mod mavesår hos Virum Akupunktur i Dyssegård. Naturlig behandling der lindrer maveproblemer og fremmer heling af maveslimhinden." },
  "/our-team/mavesyre-og-halsbrand/": { pageType: "service", metaTitle: "Mavesyre og halsbrand behandlet med akupunktur i Dyssegård | Virum Akupunktur", metaDescription: "Akupunktur mod mavesyre og halsbrand hos Virum Akupunktur i Dyssegård. Naturlig lindring uden medicin. Book en behandling i dag." },
  "/our-team/menstruationssmerter-og-endometriose/": { pageType: "service", metaTitle: "Menstruationssmerter og endometriose – akupunktur i Dyssegård | Virum Akupunktur", metaDescription: "Akupunktur mod menstruationssmerter og endometriose hos Virum Akupunktur i Dyssegård. Effektiv og skånsom smertelindring for kvinder." },
  "/our-team/morbus-crohn-og-colitis/": { pageType: "service", metaTitle: "Morbus Crohn og Colitis behandlet med akupunktur i Dyssegård | Virum Akupunktur", metaDescription: "Akupunktur mod Morbus Crohn og Colitis hos Virum Akupunktur i Dyssegård. Naturlig støttebehandling der lindrer symptomer ved tarmbetændelse." },
  "/our-team/musearm-og-tennisalbue/": { pageType: "service", metaTitle: "Musearm og tennisalbue behandlet med akupunktur i Dyssegård | Virum Akupunktur", metaDescription: "Akupunktur mod musearm og tennisalbue hos Virum Akupunktur i Dyssegård. Effektiv smertelindring og genoptræning af arm og albue." },
  "/our-team/muskelsp-ndinger-og-myoser/": { pageType: "service", metaTitle: "Muskelspændinger og myoser behandlet med akupunktur i Dyssegård | Virum Akupunktur", metaDescription: "Akupunktur mod muskelspændinger og myoser hos Virum Akupunktur i Dyssegård. Effektiv lindring af ømme muskler og spændingsknuder." },
  "/our-team/overgangsalder/": { pageType: "service", metaTitle: "Overgangsalder behandlet med akupunktur i Dyssegård | Virum Akupunktur", metaDescription: "Akupunktur mod gener i overgangsalderen hos Virum Akupunktur i Dyssegård. Lindring af hedeture, søvnproblemer og humørsvingninger." },
  "/our-team/piskesm-ld-whiplash/": { pageType: "service", metaTitle: "Piskesmæld og whiplash behandlet med akupunktur i Dyssegård | Virum Akupunktur", metaDescription: "Akupunktur mod piskesmæld og whiplash hos Virum Akupunktur i Dyssegård. Naturlig smertelindring og fremme af heling efter nakkeskade." },
  "/our-team/pms/": { pageType: "service", metaTitle: "PMS behandlet med akupunktur i Dyssegård | Virum Akupunktur", metaDescription: "Akupunktur mod PMS hos Virum Akupunktur i Dyssegård. Lindring af præmenstruelle symptomer som humørsvingninger, smerter og træthed." },
  "/our-team/prostata/": { pageType: "service", metaTitle: "Prostata behandlet med akupunktur i Dyssegård | Virum Akupunktur", metaDescription: "Akupunktur mod prostataproblemer hos Virum Akupunktur i Dyssegård. Naturlig behandling der lindrer ubehag og støtter prostatasundhed." },
  "/our-team/psoriasis/": { pageType: "service", metaTitle: "Psoriasis behandlet med akupunktur i Dyssegård | Virum Akupunktur", metaDescription: "Akupunktur mod psoriasis hos Virum Akupunktur i Dyssegård. Naturlig behandling der lindrer hudgener og reducerer betændelse." },
  "/our-team/rygestop/": { pageType: "service", metaTitle: "Rygestop med akupunktur i Dyssegård | Virum Akupunktur", metaDescription: "Brug akupunktur til rygestop hos Virum Akupunktur i Dyssegård. Effektiv støtte til at stoppe med at ryge og reducere abstinenser." },
  "/our-team/rygsmerter/": { pageType: "service", metaTitle: "Rygsmerter behandlet med akupunktur i Dyssegård | Virum Akupunktur", metaDescription: "Akupunktur mod rygsmerter hos Virum Akupunktur i Dyssegård. Effektiv smertelindring ved kroniske og akutte rygsmerter. Book en tid." },
  "/our-team/rynker-og-kosmetisk-akupunktur/": { pageType: "service", metaTitle: "Rynker og kosmetisk akupunktur i Dyssegård | Virum Akupunktur", metaDescription: "Kosmetisk akupunktur mod rynker hos Virum Akupunktur i Dyssegård. Naturlig ansigtsforyngelse uden kirurgi. Book din skønhedsbehandling." },
  "/our-team/demer-og-v-skeophobning/": { pageType: "service", metaTitle: "Ødemer og væskeophobning behandlet med akupunktur i Dyssegård | Virum Akupunktur", metaDescription: "Akupunktur mod ødemer og væskeophobning hos Virum Akupunktur i Dyssegård. Naturlig behandling der fremmer væskebalance og reducerer hævelse." },
};
