-- =====================================================================
-- SEED — marques + modules de contenu
-- Source : présentation "Avranches Automatic" (Claude Design), extraite le 10/07/2026.
-- Idempotent : ON CONFLICT DO UPDATE. Rejouable sans doublon.
-- Contenu en dollar-quoting ($j$…$j$) pour éviter l'échappement des apostrophes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Marques
-- ---------------------------------------------------------------------
INSERT INTO public.brands (key, name, tagline, pitch, color, accent, contact) VALUES
(
  'avranches',
  'Avranches Automatic',
  $j$Le leader français du loisir récréatif$j$,
  $j$Flippers, jeux d'arcade, grues & VR — en vente, location ou leasing, pour les professionnels comme les particuliers. Artisan du jeu depuis plus de 45 ans, leader français et européen, du conseil à la maintenance.$j$,
  '#7c3aed', '#C7F73E',
  $j${"phone":"+33 (0)2 33 89 61 62","email":"info@avranchesautomatic.com","website":"avranchesautomatic.com","sites":"Paris ⟷ Normandie"}$j$::jsonb
),
(
  'funtime',
  'Fun Time',
  $j$Retailtainment — commerce & divertissement$j$,
  $j$Des espaces où l'on achète, joue et collectionne : distributeurs, capsules et machines à pinces. Clé en main, modulable et sans personnel, d'une machine à 50 m² et plus. Cible « kidults » 8-40 ans.$j$,
  '#7c3aed', '#C7F73E',
  $j${"email":"info@avranchesautomatic.com","website":"avranchesautomatic.com"}$j$::jsonb
),
(
  'hypernova',
  'Hypernova',
  $j$Salle d'arcade nouvelle génération — Battle for fun$j$,
  $j$Enseigne d'arcade premium et interactive. Une app propriétaire récupère les scores en temps réel : classements, badges et tokens pour fédérer une communauté.$j$,
  '#7c3aed', '#C7F73E',
  $j${"email":"info@avranchesautomatic.com","website":"avranchesautomatic.com"}$j$::jsonb
)
ON CONFLICT (key) DO UPDATE
  SET name=EXCLUDED.name, tagline=EXCLUDED.tagline, pitch=EXCLUDED.pitch,
      color=EXCLUDED.color, accent=EXCLUDED.accent, contact=EXCLUDED.contact,
      updated_at=now();

-- ---------------------------------------------------------------------
-- Modules — AVRANCHES AUTOMATIC (société, réutilisables)
-- ---------------------------------------------------------------------
INSERT INTO public.brand_modules (brand_id, type, slug, title, subtitle, content, position) VALUES
((SELECT id FROM public.brands WHERE key='avranches'),'societe','qui-sommes-nous','La maison','Artisan du jeu depuis plus de 45 ans',
 $j${"body":"Leader sur les marchés français et européen du loisir récréatif, Avranches Automatic met plus de quatre décennies d'expérience au service de ses clients — du conseil à la maintenance.","points":["Qualité","Proximité","Suivi sur mesure","Délais rapides","Export facilité","+4000 m² de stockage"]}$j$::jsonb, 10),

((SELECT id FROM public.brands WHERE key='avranches'),'equipe','equipe','L''équipe dirigeante','Deux frères, un héritage familial',
 $j${"body":"Entreprise familiale fondée par leur père en 1980.","people":[{"name":"Léo-Paul Oblin","role":"Président","note":"10 ans en développement commercial et innovation technologique (IA industrielle). A déployé un réseau de 40 supérettes autonomes en Île-de-France.","tags":["Innovation","Développement de réseau","Expérience utilisateur"]},{"name":"Romain Oblin","role":"Vice-Président","note":"20 ans à piloter des hypermarchés. Management jusqu'à 200 personnes, a dirigé un Leclerc à plus de 50 M€ de CA.","tags":["Gestion","Organisation","Logistique"]}]}$j$::jsonb, 20),

((SELECT id FROM public.brands WHERE key='avranches'),'chiffres','chiffres-cles','En quelques chiffres','La preuve par les chiffres',
 $j${"stats":[{"value":"45","label":"Années d'expérience","note":"Artisan du jeu depuis 1980"},{"value":"14","label":"Partenaires premium","note":"Stern, Sega, Bandai Namco…"},{"value":"100+","label":"Références de jeux","note":"Flippers, arcade, grues, VR, monétique"},{"value":"2","label":"Sites logistiques","note":"Paris ⟷ Normandie"},{"value":"+5000 m²","label":"Stockage","note":"Machines testées et préparées avant expédition"}]}$j$::jsonb, 30),

((SELECT id FROM public.brands WHERE key='avranches'),'univers','nos-univers','Nos univers','Tout l''esprit du jeu, sous un même toit',
 $j${"points":["Flippers — éditions Pro, Premium & Limitées des grandes licences","Jeux d'arcade — bornes, redemption et jeux à sensations","Jeux de café & billard — baby-foot, billards, jeux de comptoir","Grues & distributeurs — grues à pinces, capsules, distributeurs nouvelle génération","Réalité virtuelle — expériences immersives pour tous les publics","Monétique — solutions d'encaissement","Pièces détachées — entretien et réparation de tout votre parc"]}$j$::jsonb, 40),

((SELECT id FROM public.brands WHERE key='avranches'),'services','nos-services','Un accompagnement complet','Du premier conseil au dernier réglage',
 $j${"points":["Conseil & sourcing — la machine juste, selon votre lieu et votre public","Transport & logistique — transporteurs adaptés aux machines premium","Installation & lancement — mise en service et prise en main sur site","Maintenance & SAV — pièces détachées et support technique dédié"]}$j$::jsonb, 50),

((SELECT id FROM public.brands WHERE key='avranches'),'partenaires','nos-partenaires','Revendeur officiel agréé','Les plus grandes marques du jeu',
 $j${"body":"Revendeur agréé des plus grandes marques (Stern, Sega, Bandai Namco…) : produits officiels, configurés et suivis."}$j$::jsonb, 60),

((SELECT id FROM public.brands WHERE key='avranches'),'acquisition','modes-acquisition','Trois façons d''installer le jeu chez vous','Professionnels & particuliers',
 $j${"options":[{"n":"01","title":"Vente","note":"Devenez propriétaire de machines d'exception, neuves ou reconditionnées.","points":["Neuf ou reconditionné garanti","Un actif qui vous appartient"]},{"n":"02","title":"Location","note":"Événements, animations et courtes durées : le jeu à la demande, livré et installé.","points":["Livré, installé, repris","Idéal événementiel & test"]},{"n":"03","title":"Leasing","note":"Étalez l'investissement et préservez votre trésorerie.","points":["Loyers lissés, trésorerie préservée","Mensualités déductibles"]}]}$j$::jsonb, 70),

((SELECT id FROM public.brands WHERE key='avranches'),'pourquoi','pourquoi-nous','Pourquoi Avranches Automatic','La tranquillité, du devis au SAV',
 $j${"points":["5000 m² de showroom et stockage — machines exposées, testées et préparées","Revendeur officiel — produits d'origine, configurés et suivis","Livraison sécurisée — partout en France et en Europe","Paiement 100% sûr — CB, virements et solutions professionnelles"],"quote":{"text":"Un bel endroit tout plein de jeux originaux et sympas. L'accueil est non moins chaleureux !","author":"Nicolas R., avis client Google"}}$j$::jsonb, 80),

((SELECT id FROM public.brands WHERE key='avranches'),'contact','contact','Passons à l''action','Visitez le showroom, essayez les machines',
 $j${"phone":"+33 (0)2 33 89 61 62","email":"info@avranchesautomatic.com","sites":"Paris ⟷ Normandie","website":"avranchesautomatic.com"}$j$::jsonb, 90)
ON CONFLICT (brand_id, slug) DO UPDATE
  SET title=EXCLUDED.title, subtitle=EXCLUDED.subtitle, content=EXCLUDED.content,
      type=EXCLUDED.type, position=EXCLUDED.position, updated_at=now();

-- ---------------------------------------------------------------------
-- Modules — FUN TIME (deck projet)
-- ---------------------------------------------------------------------
INSERT INTO public.brand_modules (brand_id, type, slug, title, subtitle, content, position) VALUES
((SELECT id FROM public.brands WHERE key='funtime'),'projet','concept','Fun Time — le concept','Retailtainment',
 $j${"body":"Le retailtainment fusionne commerce et divertissement : des espaces où l'on achète, joue et collectionne — distributeurs, capsules et machines à pinces.","points":["Modulable & plug & play : 1 machine → 50 m²+","Sans personnel","Valorise cellules & espaces non exploités","Cible « kidults » 8-40 ans"],"market":"448 Mds$ marché mondial de la collection · +8 à 10 %/an"}$j$::jsonb, 10),

((SELECT id FROM public.brands WHERE key='funtime'),'argumentaire','avantages','Retailtainment — les avantages','Six raisons d''y venir',
 $j${"points":["Engagement accru — on reste plus longtemps et on revient","Espaces valorisés — les zones sous-exploitées deviennent des zones de vente","Revenus supplémentaires — nouvelle source de CA et de marge","Sécurité renforcée — moins de vol sur les produits demandés","Différenciation — un espace unique","Fidélisation — s'associe aux programmes de fidélité"]}$j$::jsonb, 20),

((SELECT id FROM public.brands WHERE key='funtime'),'marche','public-marche','Public cible & marché','Les kidults, un marché en forte croissance',
 $j${"body":"Cœur de cible : les « kidults » 8-40 ans — fans de pop culture, collectionneurs de cartes, gén. Z/Alpha et familles (60 % féminin).","stats":[{"value":"448 Mds$","label":"Marché mondial de la collection","note":"+8 à 10 %/an"},{"value":"+24,6 %","label":"Jouets de collection","note":"≈ 5× le retail classique"},{"value":"43 %","label":"Adultes US ayant acheté des jouets pour eux en 2024"}]}$j$::jsonb, 30),

((SELECT id FROM public.brands WHERE key='funtime'),'gamme','gamme-machines','La gamme de machines','Vending, capsules & pinces',
 $j${"families":[{"name":"Vend Express / TCG Express","use":"Distributeurs cartes, figurines, blind boxes"},{"name":"Capsule Express","variants":["2P","8P","Mini"]},{"name":"Claw Express","variants":["1P LCD","4","Cube","Wall","Tower"]},{"name":"Série Vortex","variants":["Ace","Prime","Duo","4","Max"]}],"dimensions":[["Vend Express","1295 × 838 × 2390"],["TCG Express","1200 × 510 × 670"],["Capsule Express 2P","600 × 700 × 1320"],["Capsule Express 8P","2150 × 560 × 1890"],["Capsule Express Mini","1660 × 508 × 670"],["Claw Express 1P LCD","820 × 840 × 2170"],["Claw Express 4","1300 × 1120 × 2550"],["Claw Express Cube","1450 × 1450 × 2160"],["Claw Express Wall","5160 × 715 × 3060"],["Claw Express Tower","2600 × 1430 × 3120"],["Vortex Ace","813 × 940 × 2413"],["Vortex Prime","800 × 940 × 1960"],["Vortex Duo","810 × 940 × 2310"],["Vortex 4","710 × 812 × 1830"],["Vortex Max","990 × 940 × 2160"]],"dimensions_unit":"L × P × H (mm)"}$j$::jsonb, 40),

((SELECT id FROM public.brands WHERE key='funtime'),'argumentaire','solution-cle-en-main','Fun Time change la donne','Clé en main',
 $j${"body":"Une surface vide devient un espace de retailtainment rentable — livré, installé, piloté. Vous encaissez, on gère.","points":["Plug & play, sans personnel","Modulable à l'infini — d'une machine à 50 m²+","Parc piloté & data en temps réel — stocks, ventes et tendances suivis"]}$j$::jsonb, 50)
ON CONFLICT (brand_id, slug) DO UPDATE
  SET title=EXCLUDED.title, subtitle=EXCLUDED.subtitle, content=EXCLUDED.content,
      type=EXCLUDED.type, position=EXCLUDED.position, updated_at=now();

-- ---------------------------------------------------------------------
-- Modules — HYPERNOVA (deck projet)
-- ---------------------------------------------------------------------
INSERT INTO public.brand_modules (brand_id, type, slug, title, subtitle, content, position) VALUES
((SELECT id FROM public.brands WHERE key='hypernova'),'projet','concept','Hypernova','Salle d''arcade nouvelle génération',
 $j${"body":"Un univers immersif, premium et interactif entièrement dédié à l'entertainment.","points":["Jeux d'arcade pour tous","Merchandising exclusif","Vending & licences","Mur de machines à pinces (Claw Express Wall)"]}$j$::jsonb, 10),

((SELECT id FROM public.brands WHERE key='hypernova'),'argumentaire','app','Une innovation unique au monde','L''app propriétaire',
 $j${"body":"Une app et un système propriétaires récupèrent les scores des joueurs en temps réel : classements, badges et achat de tokens depuis l'application.","points":["Classement en temps réel par jeu","Events & badges à collectionner (rejouabilité)","Back-office piloté par la data — utilisateurs, contenu de jeux, badges","Compétition dans la bonne humeur — « battle for fun »"]}$j$::jsonb, 20),

((SELECT id FROM public.brands WHERE key='hypernova'),'argumentaire','modele-agile','Hypernova × Avranches Automatic','Un modèle agile',
 $j${"body":"Distributeur et enseigne avancent en cercle vertueux : chacun nourrit l'autre.","points":["Avranches → Hypernova : exclusivités, catalogue, leasing (maintenance & pièces)","Hypernova → Avranches : lab de tests, remontée de data, marché de l'occasion"]}$j$::jsonb, 30)
ON CONFLICT (brand_id, slug) DO UPDATE
  SET title=EXCLUDED.title, subtitle=EXCLUDED.subtitle, content=EXCLUDED.content,
      type=EXCLUDED.type, position=EXCLUDED.position, updated_at=now();
