function step_analysis(units)
% STEP_ANALYSIS  CSU-TAPS sprinkler corn competition, 2023 to 2025: analysis in the format of the UF STEP presentation.
% Reads only STEP_analysis_input.xlsx (sheets Farm_year and Futures). Data organized by Wub Yilma.
%
%   step_analysis        US units (bu/ac, in, lb N/ac); output folder STEP_out_US_matlab
%   step_analysis('SI')  kg/ha, mm, kg N/ha;           output folder STEP_out_SI_matlab
%
% Figures (same order as the STEP slides): S11 hybrid and yield; S12 seeding rate; S13/S14 irrigation response and
% % increase per step; S15/S16 nitrogen; S17 ETa and yield; S18 WNIPI vs cost and profit; S19 December corn futures;
% S20 correlation heat map; S21 PCA biplot by year. Results workbook: fits, correlations, % increase, PCA loadings.
% Uses only base MATLAB functions (no toolboxes); also runs in GNU Octave with the io package.

if nargin < 1, units = 'US'; end
units = upper(units);
IN  = 'STEP_analysis_input.xlsx';
OUT = ['STEP_out_' units '_matlab'];
if ~exist(OUT, 'dir'), mkdir(OUT); end
if exist('OCTAVE_VERSION', 'builtin'), pkg load io; end
set(0, 'defaultfigurevisible', 'off');

YRS = [2023 2024 2025];
COL = [76 194 76; 31 63 209; 212 154 43] / 255;          % 2023 green, 2024 blue, 2025 orange
MK  = {'^', 's', 'd'};
REF = [46 158 46] / 255;                                   % green dashed reference lines (means)

% ------------------------------------------------------------------ read data
[~, ~, raw] = xlsread(IN, 'Farm_year');
h = raw(1, :); raw = raw(2:end, :);
col = @(name) raw(:, strcmp(h, name));
num = @(name) cell2mat(col(name));
Year = num('Year'); Hyb = col('Hybrid');
[~, ~, rf] = xlsread(IN, 'Futures');
hf = rf(1, :); rf = rf(2:end, :);
fYear = cell2mat(rf(:, strcmp(hf, 'Year')));
fDate = rf(:, strcmp(hf, 'Date'));
fClose = cell2mat(rf(:, strcmp(hf, 'Close_per_bu')));
fdn = zeros(size(fDate));
for i = 1:numel(fDate)
    if ischar(fDate{i}), fdn(i) = datenum(fDate{i}, 'yyyy-mm-dd'); else, fdn(i) = fDate{i} + 693960; end
end

% ------------------------------------------------------------------ units
if strcmp(units, 'SI')
    kY = 62.77; kL = 25.4; kN = 1.12085; kA = 2.47105; kC = 1 / 25.401; kP = 2.47105; kPR = 39.368;
    L.Y = 'Yield (kg ha^{-1})'; L.I = 'Cumulative Irrigation (mm)'; L.N = 'Cumulative Nitrogen Application (kg N ha^{-1})';
    L.S = 'Seeding Rate (seeds ha^{-1})'; L.ET = 'ETa (mm)'; L.C = 'Cost of production ($/kg)'; L.PR = 'Profitability ($/ha)';
    L.PRICE = '$/t'; L.uI = 'mm'; L.uN = 'kg N ha^{-1}'; stepI = 25; stepN = 25;
else
    kY = 1; kL = 1; kN = 1; kA = 1; kC = 1; kP = 1; kPR = 1;
    L.Y = 'Yield (bu ac^{-1})'; L.I = 'Cumulative Irrigation (in)'; L.N = 'Cumulative Nitrogen Application (lb N ac^{-1})';
    L.S = 'Seeding Rate (seeds ac^{-1})'; L.ET = 'ETa (in)'; L.C = 'Cost of production ($/bu)'; L.PR = 'Profitability ($/ac)';
    L.PRICE = '$/bu'; L.uI = 'in'; L.uN = 'lb N ac^{-1}'; stepI = 1; stepN = 20;
end
D.Yield  = num('Yield_bu_ac') * kY;   D.I  = num('Irrigation_in') * kL;  D.N = num('N_lb_ac') * kN;
D.SR     = num('Seed_per_ac') * kA;   D.ET = num('ETa_in') * kL;         D.P = num('Rain_in') * kL;
D.WNIPI  = num('WNIPI');              D.Cost = num('Cost_per_bu') * kC;  D.Profit = num('Profit_per_ac') * kP;
R = {};                                                    % results: {sheet name, cell array}

% ------------------------------------------------------------------ S11 hybrid selection and yield
hy = sort(unique(Hyb)); hy = hy(end:-1:1); nh = numel(hy);
[~, pos] = ismember(Hyb, hy);
cnt = accumarray(pos, 1); [~, itop] = max(cnt);
f = figure('Position', [50 50 1100 560]);
xl = [min(D.Yield) * 0.92, max(D.Yield) * 1.05];
for j = 1:3
    ax = subplot(1, 4, j); hold on; box on
    set(ax, 'Color', [0.92 0.92 0.92], 'XGrid', 'on', 'YGrid', 'on', 'GridColor', [1 1 1], 'GridAlpha', 1);
    m = Year == YRS(j);
    scatter(D.Yield(m), pos(m), 28, COL(j, :), 'filled');
    xlim(xl); ylim([0.3 nh + 0.7]); set(ax, 'YTick', 1:nh);
    if j == 1, set(ax, 'YTickLabel', hy, 'FontSize', 7); ylabel('Hybrid'); else, set(ax, 'YTickLabel', {}); end
    title(num2str(YRS(j)));
    rectangle('Position', [xl(1) itop - 0.5 diff(xl) 1], 'EdgeColor', [0.75 0.22 0.17], 'LineWidth', 1.4);
    if j == 2, xlabel('Yield'); end
end
ax = subplot(1, 4, 4); axis(ax, 'off'); hold on
text(0.05, 0.95, 'Year'); text(0.55, 0.95, 'Yield');
for j = 1:3
    text(0.05, 0.85 - 0.08 * j, num2str(YRS(j))); text(0.55, 0.85 - 0.08 * j, sprintf('%.0f', mean(D.Yield(Year == YRS(j)))));
    scatter(0.08, 0.45 - 0.08 * j, 28, COL(j, :), 'filled'); text(0.15, 0.45 - 0.08 * j, num2str(YRS(j)));
end
xlim([0 1]); ylim([0 1]);
save_fig(f, OUT, 'S11_hybrid_selection_yield');
mt = pos == itop; C = {'Hybrid', 'Year', 'n', 'min', 'max'};
for j = 1:3
    m = mt & Year == YRS(j);
    if any(m), C(end + 1, :) = {hy{itop}, YRS(j), sum(m), min(D.Yield(m)), max(D.Yield(m))}; end %#ok<AGROW>
end
R(end + 1, :) = {'Hybrid_top', C};

% ------------------------------------------------------------------ S12 seeding rate and yield
f = figure('Position', [50 50 820 430]); ax = axes; hold on; box on
points(ax, D.SR, D.Yield, Year, YRS, COL, MK); means(D.SR, D.Yield, REF);
xlabel(L.S); ylabel(L.Y); ylim([0 max(D.Yield) * 1.12]);
save_fig(f, OUT, 'S12_seeding_rate_yield');

% ------------------------------------------------------------------ S13 to S16 quadratic response and % increase
R = response(D.I, D.Yield, Year, YRS, COL, MK, REF, L.I, L.Y, stepI, ['Irrigation Application (' L.uI ')'], 'S13_S14_irrigation', OUT, R);
R = response(D.N, D.Yield, Year, YRS, COL, MK, REF, L.N, L.Y, stepN, ['Nitrogen Application (' L.uN ')'], 'S15_S16_nitrogen', OUT, R);

% ------------------------------------------------------------------ S17 ETa and yield
f = figure('Position', [50 50 820 450]); ax = axes; hold on; box on
C = {'Year', 'slope', 'intercept', 'R2', 'ET_at_zero_yield'}; x0 = zeros(1, 3);
for j = 1:3
    m = Year == YRS(j);
    scatter(D.ET(m), D.Yield(m), 40, COL(j, :), 'filled', 'Marker', MK{j});
    [c, r2] = fitp(D.ET(m), D.Yield(m), 1); x0(j) = -c(2) / c(1);
    xs = linspace(max(x0(j), 0), max(D.ET) * 1.05, 50); plot(xs, polyval(c, xs), ':', 'Color', COL(j, :), 'LineWidth', 1.3, 'HandleVisibility', 'off');
    C(end + 1, :) = {YRS(j), c(1), c(2), r2, x0(j)}; %#ok<AGROW>
end
xlim([0 max(D.ET) * 1.15]); ylim([0 max(D.Yield) * 1.12]);
for j = 1:3, ntext(0.06 + mod(j - 1, 2) * 0.26, 0.95 - floor((j - 1) / 2) * 0.13, eqtext([C{j + 1, 2} C{j + 1, 3}], C{j + 1, 4}, YRS(j)), 'left'); end
plot(xlim, [1 1] * mean(D.Yield), '--', 'Color', REF, 'HandleVisibility', 'off');
legend(arrayfun(@num2str, YRS, 'UniformOutput', false), 'Location', 'southeast');
text(0.02 * max(D.ET), 0.36 * max(D.Yield), '| ET Needed to produce any yield |', 'FontSize', 9);
xm = mean(max(x0(x0 > 0), 0)); t = linspace(0, pi, 30);
plot(xm / 2 + xm / 2 * cos(t), 0.02 * max(D.Yield) + 0.15 * max(D.Yield) * sin(t), 'Color', [0.18 0.49 0.2], 'LineWidth', 1.3, 'HandleVisibility', 'off');
xlim([0 max(D.ET) * 1.15]); ylim([0 max(D.Yield) * 1.12]); xlabel(L.ET); ylabel(L.Y);
save_fig(f, OUT, 'S17_ET_yield'); R(end + 1, :) = {'S17_ET_fits', C};

% ------------------------------------------------------------------ S18 efficiency (WNIPI) vs cost and profitability
f = figure('Position', [50 50 1150 430]); C = {'y', 'Year', 'slope', 'intercept', 'R2'};
ys = {D.Cost, D.Profit}; yl = {L.C, L.PR}; xlabs = {'Efficiency(WNIPI)', 'WNIPI'}; nm = {'Cost', 'Profit'};
for p = 1:2
    ax = subplot(1, 2, p); hold on; box on
    points(ax, D.WNIPI, ys{p}, Year, YRS, COL, MK);
    for j = 1:3
        m = Year == YRS(j); [c, r2] = fitp(D.WNIPI(m), ys{p}(m), 1);
        xs = linspace(min(D.WNIPI(m)), max(D.WNIPI(m)), 20); plot(xs, polyval(c, xs), ':', 'Color', COL(j, :), 'LineWidth', 1.3, 'HandleVisibility', 'off');
        C(end + 1, :) = {nm{p}, YRS(j), c(1), c(2), r2}; %#ok<AGROW>
    end
    yy = [min(ys{p}), max(ys{p})]; ylim([yy(1) - 0.15 * diff(yy), yy(2) + 0.45 * diff(yy)]);
    xx = [min(D.WNIPI), max(D.WNIPI)]; xlim([xx(1) - 0.05 * diff(xx), xx(2) + 0.05 * diff(xx)]);
    for j = 1:3, r = size(C, 1) - 3 + j; ntext(0.97, 0.96 - 0.12 * (j - 1), eqtext([C{r, 3} C{r, 4}], C{r, 5}, YRS(j)), 'right'); end
    if p == 2, plot(xlim, [0 0], 'k--', 'HandleVisibility', 'off'); end
    xlabel(xlabs{p}); ylabel(yl{p});
end
save_fig(f, OUT, 'S18_WNIPI_cost_profit'); R(end + 1, :) = {'S18_WNIPI_fits', C};

% ------------------------------------------------------------------ S19 December corn futures
f = figure('Position', [50 50 870 450]); hold on; box on
C = {'Year', 'start', 'end', 'min', 'max'};
for j = 1:3
    m = fYear == YRS(j); dv = datevec(fdn(m)); x = datenum(2000, dv(:, 2), dv(:, 3));
    plot(x, fClose(m) * kPR, 'Color', COL(j, :), 'LineWidth', 1.4);
    C(end + 1, :) = {YRS(j), datestr(min(fdn(m)), 'yyyy-mm-dd'), datestr(max(fdn(m)), 'yyyy-mm-dd'), min(fClose(m)), max(fClose(m))}; %#ok<AGROW>
end
set(gca, 'XTick', datenum(2000, 3:12, 1)); datetick('x', 'mmm', 'keepticks');
xlim([datenum(2000, 3, 1) datenum(2000, 12, 1)]); ylabel(L.PRICE); ntext(0.03, 0.93, 'December Corn Futures, 2023-2025', 'left');
legend(arrayfun(@num2str, YRS, 'UniformOutput', false), 'Location', 'southoutside', 'Orientation', 'horizontal');
save_fig(f, OUT, 'S19_futures_price'); R(end + 1, :) = {'S19_price_summary', C};

% ------------------------------------------------------------------ S20 correlation heat map
vars = {'P', 'Profit', 'ET', 'I', 'Yield', 'N', 'SR', 'WNIPI'};
X = zeros(numel(D.Yield), 8); for v = 1:8, X(:, v) = D.(vars{v}); end
Cm = corrcoef(X); M = Cm(end:-1:1, :);
cmap = interp1(linspace(-1, 1, 6), [245 230 26; 244 160 74; 232 107 196; 176 79 224; 106 54 230; 42 42 216] / 255, linspace(-1, 1, 256));
f = figure('Position', [50 50 660 620]); imagesc(M, [-1 1]); colormap(cmap); cb = colorbar; ylabel(cb, 'r');
for i = 1:8, for j = 1:8, text(j, i, sprintf('%.2f', M(i, j)), 'HorizontalAlignment', 'center', 'Color', 'w', 'FontSize', 9); end, end
set(gca, 'XTick', 1:8, 'XTickLabel', vars, 'YTick', 1:8, 'YTickLabel', vars(end:-1:1)); axis image
title('Correlation Matrix of Agronomic and Economic Variables');
save_fig(f, OUT, 'S20_correlation_heatmap');
C = [{''}, vars; vars', num2cell(Cm)]; R(end + 1, :) = {'S20_correlation', C};
C = {'Variable', '2023', '2024', '2025'};
for v = 1:8
    row = {vars{v}};
    for j = 1:3, m = Year == YRS(j); cc = corrcoef(X(m, v), D.Yield(m)); row{end + 1} = cc(1, 2); end %#ok<AGROW>
    C(end + 1, :) = row; %#ok<AGROW>
end
R(end + 1, :) = {'S20_within_season_r_yield', C};

% ------------------------------------------------------------------ S21 PCA biplot by year (SVD of standardized data)
pv = {'Profit', 'Yield', 'ET', 'I', 'N', 'SR', 'P', 'WNIPI'};
pl = {'Profit', 'Yield', 'ET', 'Irrigation', 'NInput', 'Plant.Population', 'P', 'WNIPI'};
Z = zeros(numel(D.Yield), 8); for v = 1:8, Z(:, v) = D.(pv{v}); end
n = size(Z, 1); Zs = (Z - repmat(mean(Z), n, 1)) ./ repmat(std(Z, 1), n, 1);
[~, S, V] = svd(Zs, 'econ'); ev = diag(S) .^ 2 / (n - 1); vr = 100 * ev / sum(ev);
sc = Zs * V(:, 1:2); ld = V(:, 1:2) .* repmat(sqrt(ev(1:2))', 8, 1);
if ld(2, 1) < 0, sc(:, 1) = -sc(:, 1); ld(:, 1) = -ld(:, 1); end      % Yield to the right
if ld(1, 2) < 0, sc(:, 2) = -sc(:, 2); ld(:, 2) = -ld(:, 2); end      % Profit up
f = figure('Position', [50 50 660 580]); hold on; box on
pm = {'^', 's', '+'}; t = linspace(0, 2 * pi, 100);
for j = 1:3
    s2 = sc(Year == YRS(j), :); mu = mean(s2); [vv, dd] = eig(cov(s2));
    e = repmat(mu', 1, 100) + vv * sqrt(5.991 * dd) * [cos(t); sin(t)];
    fill(e(1, :), e(2, :), COL(j, :), 'FaceAlpha', 0.18, 'EdgeColor', COL(j, :), 'HandleVisibility', 'off');
    plot(s2(:, 1), s2(:, 2), pm{j}, 'Color', COL(j, :), 'MarkerFaceColor', COL(j, :), 'MarkerSize', 5);
    plot(mu(1), mu(2), pm{j}, 'Color', COL(j, :), 'MarkerFaceColor', COL(j, :), 'MarkerSize', 12, 'HandleVisibility', 'off');
end
for v = 1:8
    quiver(0, 0, ld(v, 1) * 2.6, ld(v, 2) * 2.6, 0, 'Color', [0.2 0.2 0.2], 'MaxHeadSize', 0.3, 'HandleVisibility', 'off');
    text(ld(v, 1) * 2.8, ld(v, 2) * 2.8, pl{v}, 'FontSize', 8);
end
lim = max(max(abs(sc(:))), 3) * 1.15; xlim([-lim lim]); ylim([-lim lim]);
plot([-lim lim], [0 0], 'k--', 'HandleVisibility', 'off'); plot([0 0], [-lim lim], 'k--', 'HandleVisibility', 'off');
xlabel(sprintf('Dim1 (%.1f%%)', vr(1))); ylabel(sprintf('Dim2 (%.1f%%)', vr(2))); title('PCA Spatial Biplot by Year');
legend(arrayfun(@num2str, YRS, 'UniformOutput', false), 'Location', 'northeast');
save_fig(f, OUT, 'S21_PCA_biplot');
C = [{'Variable', sprintf('Dim1 (%.1f%%)', vr(1)), sprintf('Dim2 (%.1f%%)', vr(2))}; pl', num2cell(ld)];
R(end + 1, :) = {'S21_PCA_loadings', C};

% ------------------------------------------------------------------ results workbook
fx = fullfile(OUT, ['STEP_results_' units '_matlab.xlsx']);
if exist(fx, 'file'), delete(fx); end
writesheet(fx, 'ReadMe', {'Item', 'Value'; 'Units', units; 'Input', IN; 'Organized by', 'Data organized by Wub Yilma'});
for r = 1:size(R, 1), writesheet(fx, R{r, 1}, R{r, 2}); end
fprintf('done: %s\n', OUT);
end

% ================================================================== local functions
function R = response(x, y, Year, YRS, COL, MK, REF, xlab, ylab, step, pctlab, name, OUT, R)
f = figure('Position', [50 50 820 430]); ax = axes; hold on; box on
points(ax, x, y, Year, YRS, COL, MK); means(x, y, REF);
C = {'Year', 'a', 'b', 'c', 'R2', 'x_at_max_yield'}; cf = zeros(3, 3); xopt = nan(1, 3);
for j = 1:3
    m = Year == YRS(j); [c, r2] = fitp(x(m), y(m), 2); cf(j, :) = c;
    xs = linspace(0, max(x) * 1.05, 100); plot(xs, polyval(c, xs), ':', 'Color', COL(j, :), 'LineWidth', 1.3, 'HandleVisibility', 'off');
    if c(1) < 0, xopt(j) = -c(2) / (2 * c(1)); end
    C(end + 1, :) = {YRS(j), c(1), c(2), c(3), r2, xopt(j)}; %#ok<AGROW>
end
xlim([0 max(x) * 1.5]); ylim([0 max(y) * 1.15]); xlabel(xlab); ylabel(ylab);
for j = 1:3, ntext(0.99, 0.84 - 0.15 * (j - 1), eqtext(cf(j, :), C{j + 1, 5}, YRS(j)), 'right'); end
save_fig(f, OUT, [name '_yield']); R(end + 1, :) = {[name '_fits'], C};
% percent increase in fitted yield for each added step
xs = step:step:(max(x) * 1.3 + step); P = {'Year', 'x', 'pct_increase'}; allv = [];
f = figure('Position', [50 50 820 430]); hold on; box on
for j = 1:3
    base = polyval(cf(j, :), xs - step); ok = base > 0.3 * max(y);            % skip near-zero fitted yields
    v = 100 * (polyval(cf(j, :), xs) - base) ./ base;
    scatter(xs(ok), v(ok), 12, COL(j, :), 'filled'); allv = [allv, v(ok)]; %#ok<AGROW>
    P = [P; num2cell([repmat(YRS(j), sum(ok), 1), xs(ok)', v(ok)'])]; %#ok<AGROW>
end
lo = min(-10, min(allv) * 1.3); hi = max(allv) * 1.25;
ok = xopt > min(x) & xopt < max(x);
if any(ok)
    rectangle('Position', [min(xopt(ok)) - step / 2, lo * 0.97, max(xopt(ok)) - min(xopt(ok)) + step, (hi - lo) * 0.95], 'EdgeColor', [0.75 0.22 0.17], 'LineWidth', 1.6);
end
plot([0 max(xs) + step], [0 0], 'k--', 'HandleVisibility', 'off'); ylim([lo hi]); xlim([0 max(xs) + step]);
legend(arrayfun(@num2str, YRS, 'UniformOutput', false), 'Location', 'northeast');
xlabel(pctlab); ylabel('% Increase in Yield');
save_fig(f, OUT, [name '_pct_increase']); R(end + 1, :) = {[name '_pct'], P};
end

function ntext(xn, yn, str, ha)
% text placed at normalized axes position (computed from the current limits; works in MATLAB and Octave)
xl = xlim; yl = ylim; lines = strsplit(str, sprintf('\n'));
for k = 1:numel(lines)
    text(xl(1) + xn * diff(xl), yl(1) + (yn - 0.055 * (k - 1)) * diff(yl), lines{k}, 'HorizontalAlignment', ha, 'VerticalAlignment', 'top', 'FontSize', 8);
end
end

function points(ax, x, y, Year, YRS, COL, MK)
for j = 1:3
    m = Year == YRS(j); scatter(ax, x(m), y(m), 28, COL(j, :), 'filled', 'Marker', MK{j});
end
legend(ax, arrayfun(@num2str, YRS, 'UniformOutput', false), 'Location', 'northwest', 'Orientation', 'horizontal');
end

function means(x, y, REF)
xl = [0, max(x) * 1.5]; yl = [0, max(y) * 1.15];
plot(xl, [1 1] * mean(y), '--', 'Color', REF, 'HandleVisibility', 'off');
plot([1 1] * mean(x), yl, '--', 'Color', REF, 'HandleVisibility', 'off');
end

function [c, r2] = fitp(x, y, deg)
c = polyfit(x, y, deg); yh = polyval(c, x);
r2 = 1 - sum((y - yh) .^ 2) / sum((y - mean(y)) .^ 2);
end

function s = eqtext(c, r2, yr)
sg = @(v) sprintf('%s %.4g', char(43 * (v >= 0) + 45 * (v < 0)), abs(v));
if numel(c) == 3
    s = sprintf('y_{%d} = %.4gx^2 %sx %s\nR^2 = %.2f', yr, c(1), sg(c(2)), sg(c(3)), r2);
else
    s = sprintf('y_{%d} = %.4gx %s\nR^2 = %.2f', yr, c(1), sg(c(2)), r2);
end
end

function save_fig(f, OUT, name)
print(f, fullfile(OUT, [name '.png']), '-dpng', '-r300'); close(f);
end

function writesheet(fx, sheet, C)
if exist('writecell', 'file') || exist('writecell', 'builtin')
    writecell(C, fx, 'Sheet', sheet);
else
    xlswrite(fx, C, sheet);
end
end
