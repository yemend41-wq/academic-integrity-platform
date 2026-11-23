"""Write the assessment build card for the currently selected research detector."""
from pathlib import Path
import json
root=Path(__file__).resolve().parent
load=lambda file:json.loads((root/file).read_text())
en=load('active-english-cohorts.json')
ar=load('arabic-challenger-metrics.json')
domain=load('challenger-metrics.json')
untouched=load('strict-holdout-metrics.json')['control']
def group(label,lang,rows,den='eligible',any_signal='any',visible='visible'):
    return {'group':label,'language':lang,'alerts':sum(r[any_signal] for r in rows),
            'eligible':sum(r[den] for r in rows),'numeric_alerts':sum(r[visible] for r in rows)}
def human(label,keys):
    return group(label,'en',[en[k] for k in keys],'eligible','flagged_including_suppressed','flagged_at_least_20_percent')
def recall(rows,den='eligible',num='any'):
    return {'detected':sum(r[num] for r in rows),'eligible':sum(r[den] for r in rows)}
all_en=[k for k,r in en.items() if r['origin']=='human']
general=[r for k,r in domain.items() if k.startswith(('mage','raid')) and k.endswith('__0')]
general_ai=[r for k,r in domain.items() if k.startswith(('mage','raid')) and k.endswith('__1')]
g=[human('English / Liang human cohorts',all_en),human('English / TOEFL (non-native)',['TOEFL_real_91']),
   group('English / held-out MAGE and RAID','en',general),
   group('English / UKP persuasive essays','en',[untouched['UKP persuasive essays']]),
   group('Arabic / course-project human collection','ar',[ar['oqn_human']]),
   group('Arabic / Ar-APT original press articles','ar',[ar['ar_apt_human']]),
   group('Arabic / KFUPM human academic abstracts','ar',[ar['academic_human']]),
   group('Arabic / ANAD 2021 news','ar',[untouched['ANAD 2021 news']])]
card={'version':'AIP-HL-3','purpose':'Experimental bilingual review signal in the assessment build.',
      'production_release':False,'deployment_class':'experimental_review_signal',
      'training':{'family':'Separate English and Arabic logistic regressions on hashed lexical features and balanced document-level fitting.',
                  'windows':'96 words, stride of 32, minimum 48 words. Sentence spans inherit the nearest window score. Positive document shares under 20% are suppressed.',
                  'origin':['AIRABIC books, news and generated text; pre-2019 Arabic Wikipedia paragraphs from ARCD.',
                            'Paired English TOEFL-style writing plus MAGE and RAID development examples.']},
      'limits':{'en':'External human group rates and machine recall vary by genre. The English detector exceeded 1% on the inclusive MAGE/RAID endpoint.',
                'ar':'High measured false alarms in Arabic, including academic and student-contributed material. Treat highlights as experimental.',
                'general':'Numeric percentages represent eligible words within flagged units. No authorship or misconduct determination may be made from the score alone.'},
      'acceptance':{'false_positive_rate_below_one_percent':'failed','production_release':False,'fairness_certified':False,
                    'committee_blind_test':'not_run','paraphrase_resilience':'not_established','backtranslation_resilience':'not_established'},
      'groups':g,'ai_recall':{'english_general':recall(general_ai),'english_rewritten_college':recall([en['CollegeEssay_gpt3PromptEng_31']],'eligible','flagged_including_suppressed'),
                              'arabic_external':recall([ar['oqn_ai']]),'arabic_generated_press':recall([ar['ar_apt_machine']]),
                              'english_generated_argugpt':recall([untouched['ArguGPT generated test essays']])},
      'roundtrip':load('active-roundtrip.json'),'active_heldout':load('active-group-metrics.json'),'baseline':load('metrics.json'),
      'challenger':load('challenger-decision.json'),'arabic_challenger':load('arabic-challenger-decision.json'),
      'strict_operating_point':load('strict-holdout-summary.json'),
      'operating_points':[{'id':'AIP-HL-1','state':'archived baseline','record':'historical-baseline-card.json'},
                          {'id':'AIP-HL-2','state':'English research challenger, failed release','record':'challenger-decision.json'},
                          {'id':'AIP-HL-3','state':'selected for experimental assessment, failed release','record':'arabic-challenger-decision.json'},
                          {'id':'AIP-HL-4-research','state':'rejected: insufficient sensitivity','record':'strict-holdout-summary.json'}]}
card['release4']=load('release4-study.json')
(root/'card.json').write_text(json.dumps(card,indent=2)+'\n')
