// Prebuilt search URLs for the sites that have no usable public API.
//
// LinkedIn's Jobs API needs a Talent Solutions partnership that is not open to
// individuals, and Handshake has no public API at all — it is gated behind your
// university login. Scraping either would breach their terms and the project
// rule against scraping, so instead each link opens that site's own search with
// the keywords, location and radius already filled in.

// Search funds post their internships on community boards (Searchfunder,
// Search Fund Careers) whose terms forbid scraping or copying listings, and
// the job APIs carry almost none of them. So they are links too — US-wide,
// because searchers hire students from anywhere and much of the work is remote.
const SEARCH_FUND = /\b(search ?funds?|searchers?|entrepreneurship through acquisition|eta)\b/i;

export const wantsSearchFunds = (query) => [query.major, ...(query.interests || [])].some((s) => SEARCH_FUND.test(String(s || '')));

function searchFundLinks() {
  return [
    {
      name: 'Searchfunder',
      group: 'Search funds (anywhere in the US)',
      url: 'https://searchfunder.com/latest/job',
      note: 'Job posts from searchers and the companies they bought, including student internships and remote roles. Sign in to reply to a post.',
    },
    {
      name: 'Search Fund Careers',
      group: 'Search funds (anywhere in the US)',
      url: 'https://searchfundcareers.com/',
      note: 'A job board for the search fund community: internships and full-time roles.',
    },
    {
      name: 'LinkedIn: search funds',
      group: 'Search funds (anywhere in the US)',
      url: `https://www.linkedin.com/jobs/search/?${new URLSearchParams({
        keywords: 'search fund intern',
        location: 'United States',
        f_E: '1',
        sortBy: 'DD',
      })}`,
      note: 'Internship-level search fund postings across the US, newest first.',
    },
    {
      name: 'Indeed: search funds',
      group: 'Search funds (anywhere in the US)',
      url: `https://www.indeed.com/jobs?${new URLSearchParams({ q: '"search fund" intern', l: 'United States' })}`,
      note: 'Postings that mention “search fund”, across the US.',
    },
  ];
}

// Industry job boards for majors whose internships are mostly posted outside
// the big sites. Shown only when the search is for that major (`field` is the
// track detectField picked).
const FIELD_BOARDS = {
  'sport-management': [
    {
      // teamworkonline.com answers automated requests with a bot check, so this
      // URL cannot be link-checked. It works in a browser.
      name: 'TeamWork Online',
      url: 'https://www.teamworkonline.com/',
      note: 'The job board pro teams, leagues and college athletic departments use for jobs and internships. Free to search.',
    },
  ],
  agribusiness: [
    {
      name: 'AgCareers.com internships',
      url: 'https://www.agcareers.com/internships.cfm',
      note: 'Agriculture and food internships, including sales, agronomy and operations roles.',
    },
  ],
  'actuarial-science': [
    {
      name: 'Be An Actuary: internships',
      url: 'https://www.beanactuary.org/jobs-and-internships/actuarial-internships/',
      note: 'How to find an actuarial internship, from the SOA and CAS, with links to their job boards.',
    },
    {
      // jobs.soa.org answers automated requests with a bot check, so this URL
      // cannot be link-checked. It works in a browser.
      name: 'SOA Job Center',
      url: 'https://jobs.soa.org/',
      note: 'The Society of Actuaries’ job board.',
    },
  ],
  'financial-planning': [
    {
      name: 'CFP Board internships',
      url: 'https://www.cfp.net/for-cfp-pros/career-center/find-internship',
      note: 'CFP Board’s free board of financial planning internships.',
    },
  ],
};

export function deepLinks(query, field = null) {
  const kw = ['intern', query.major, ...(query.interests || [])].filter(Boolean).join(' ');
  const bare = [query.major, ...(query.interests || [])].filter(Boolean).join(' ');
  const zip = query.zip || '';
  const place = query.place ? `${query.place.city}, ${query.place.state}` : zip;
  // The boards' own distance menus stop at 100 miles, and a value they do not
  // offer is ignored, so a wider search links at their widest.
  const radius = Math.min(query.radiusMiles || 50, 100);

  const links = [
    {
      name: 'LinkedIn Jobs',
      group: 'Major boards',
      url: `https://www.linkedin.com/jobs/search/?${new URLSearchParams({
        keywords: kw,
        location: place,
        distance: String(radius),
        f_E: '1', // internship experience level
        f_TPR: 'r2592000', // posted in the last 30 days
        sortBy: 'DD',
      })}`,
      note: `Internship level within ${radius} miles of ${place}, posted in the last 30 days.`,
    },
    {
      name: 'Handshake',
      group: 'Major boards',
      url: `https://app.joinhandshake.com/stu/postings?${new URLSearchParams({
        query: kw,
        'job.jobType': 'internship',
        location: place,
      })}`,
      note: 'Sign in with your .edu account — Handshake then adds your school’s employer relationships.',
    },
    {
      // indeed.com returns 403 to every automated request, including its own
      // home page, so this URL cannot be link-checked. It works in a browser.
      name: 'Indeed',
      group: 'Major boards',
      url: `https://www.indeed.com/jobs?${new URLSearchParams({
        q: kw,
        l: zip || place,
        radius: String(radius),
        sc: '0kf:jt(internship);',
        fromage: '30',
      })}`,
      note: `Internship job type, ${radius}-mile radius from ${zip || place}.`,
    },
    {
      name: 'SimplyHired',
      group: 'Major boards',
      url: `https://www.simplyhired.com/search?${new URLSearchParams({ q: kw, l: zip || place })}`,
      note: 'Aggregates postings from many boards, including ones the APIs miss.',
    },
    {
      name: 'Monster',
      group: 'Major boards',
      url: `https://www.monster.com/jobs/search?${new URLSearchParams({ q: kw, where: place, rd: String(radius) })}`,
      note: `${radius}-mile radius from ${place}.`,
    },
    {
      // Glassdoor only takes a location as its own internal ID, so the
      // search runs US-wide and the student narrows it there.
      name: 'Glassdoor',
      group: 'Major boards',
      url: `https://www.glassdoor.com/Job/jobs.htm?${new URLSearchParams({ 'sc.keyword': kw })}`,
      note: 'Searches all of the US; set your location on Glassdoor. Company reviews and pay sit next to each posting.',
    },
    {
      name: 'Google Jobs',
      group: 'Major boards',
      url: `https://www.google.com/search?${new URLSearchParams({ q: `${bare ? `${bare} ` : ''}internship near ${place}`, udm: '8' })}`,
      note: 'Google’s job search, which gathers postings from many sites at once.',
    },
    {
      name: 'USAJOBS',
      group: 'Government',
      url: `https://www.usajobs.gov/Search/Results?${new URLSearchParams({
        k: kw,
        l: place,
        rad: String(radius),
        hp: 'student',
      })}`,
      note: 'Students & recent graduates hiring path.',
    },
    {
      name: 'Virtual Student Federal Service',
      group: 'Government',
      url: 'https://careers.state.gov/interns-fellows/virtual-student-federal-service/',
      note: 'Remote federal internships across 30+ agencies. Applications open each July.',
    },
    {
      name: 'WayUp',
      group: 'Student-focused',
      url: 'https://www.wayup.com/',
      note: 'Built for students and recent grads. Search from their home page.',
    },
    {
      name: 'RippleMatch',
      group: 'Student-focused',
      url: 'https://ripplematch.com/jobs/',
      note: 'Matches you to internships from your profile rather than a keyword search.',
    },
    {
      name: 'Chegg Internships',
      group: 'Student-focused',
      url: 'https://www.chegg.com/internships',
      note: 'Internship-only board, searchable by major and location.',
    },
    {
      name: 'eFinancialCareers',
      group: 'Finance',
      url: `https://www.efinancialcareers.com/jobs?${new URLSearchParams({ q: kw, location: place, radius: String(radius), radiusUnit: 'mi' })}`,
      note: `Banking, finance and fintech roles within ${radius} miles of ${place}.`,
    },
    {
      name: 'Built In',
      group: 'Startups and nonprofits',
      url: `https://builtin.com/jobs?${new URLSearchParams({ search: kw })}`,
      note: 'Tech and startup companies, business roles included. Searches all of the US.',
    },
    {
      name: 'Wellfound',
      group: 'Startups and nonprofits',
      url: 'https://wellfound.com/jobs',
      note: 'Startup jobs. Create a free account to search and apply.',
    },
    {
      name: 'Idealist',
      group: 'Startups and nonprofits',
      url: `https://www.idealist.org/en/internships${bare ? `?${new URLSearchParams({ q: bare })}` : ''}`,
      note: 'Internships at nonprofits and social-impact organizations, including remote ones.',
    },
    {
      name: 'Forage job simulations',
      group: 'Experience instead of a posting',
      url: `https://www.theforage.com/simulations${bare ? `?${new URLSearchParams({ search: bare })}` : ''}`,
      note: 'Free employer-built simulations. Do one when applications are closed — it still counts.',
    },
    {
      name: 'Parker Dewey',
      group: 'Experience instead of a posting',
      url: 'https://www.parkerdewey.com/career-launchers',
      note: 'Paid, short-term projects (micro-internships) for college students.',
    },
  ];

  // The search's own field gets its industry boards straight after the major
  // boards. Everyone sees the search fund boards; someone who asked for them
  // sees them there too instead of at the end.
  const firstOther = links.findIndex((l) => l.group !== 'Major boards');
  const industry = (FIELD_BOARDS[field?.id] || []).map((l) => ({ ...l, group: `${field.name} boards` }));
  const funds = searchFundLinks();
  const early = wantsSearchFunds(query) ? [...industry, ...funds] : industry;
  const late = wantsSearchFunds(query) ? [] : funds;
  return [...links.slice(0, firstOther), ...early, ...links.slice(firstOther), ...late];
}
