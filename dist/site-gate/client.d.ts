import * as react_jsx_runtime from 'react/jsx-runtime';

interface SiteGateBarProps {
    /** e.g. the site's word for "Under construction. Visitors see the coming-soon page." */
    text: string;
    /** The site's word for "View as visitors see it". */
    visitorViewLabel: string;
    /** The site's word for "Settings". */
    settingsLabel: string;
    /** Where "Settings" goes (the dashboard's Website Settings URL). */
    settingsUrl: string;
}
/** Team view: slim charcoal sticky bar with a gold dot. */
declare function SiteGateBar({ text, visitorViewLabel, settingsLabel, settingsUrl }: SiteGateBarProps): react_jsx_runtime.JSX.Element | null;
interface PreviewPillProps {
    /** e.g. the site's word for "Preview · not public yet". */
    text: string;
}
/** Preview-link guest: a small pill at the bottom-start corner. */
declare function PreviewPill({ text }: PreviewPillProps): react_jsx_runtime.JSX.Element | null;

export { PreviewPill, type PreviewPillProps, SiteGateBar, type SiteGateBarProps };
